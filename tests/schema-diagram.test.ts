import { test } from "node:test";
import assert from "node:assert/strict";
import { describeChanges } from "../src/lib/migrations/changes";
import { buildDiagram, type DiagramTable } from "../src/lib/migrations/diagram";
import type { ColumnInfo, TableInfo } from "../src/lib/types";

const one = (sql: string) => describeChanges([{ version: "1", sql }]);

function column(name: string, type = "text", isPrimaryKey = false): ColumnInfo {
  return {
    name,
    type,
    dataType: type,
    typeCategory: "S",
    nullable: !isPrimaryKey,
    isPrimaryKey,
    isGenerated: false,
    isIdentity: false,
    hasDefault: false,
  };
}

const users: TableInfo = {
  schema: "public",
  name: "users",
  kind: "table",
  columns: [column("id", "uuid", true), column("email"), column("name")],
  foreignKeys: [],
  referencedBy: [],
};

function table(tables: DiagramTable[], id: string): DiagramTable {
  const found = tables.find((item) => item.id === id);
  assert.ok(found, `no table ${id} in ${tables.map((item) => item.id).join(", ")}`);
  return found;
}

test("foreign keys carry where they point, inline and table-level", () => {
  const changes = one(`
    CREATE TABLE app.orders (
      id bigint PRIMARY KEY,
      user_id uuid REFERENCES users(id),
      shop_id int,
      CONSTRAINT orders_shop_fk FOREIGN KEY (shop_id) REFERENCES app.shops
    );
  `);
  const parts = changes.subjects[0].parts;
  assert.deepEqual(parts.find((part) => part.name === "user_id")?.ref, {
    columns: ["user_id"],
    schema: "public",
    table: "users",
    targetColumns: ["id"],
  });
  assert.deepEqual(parts.find((part) => part.name === "orders_shop_fk")?.ref, {
    columns: ["shop_id"],
    schema: "app",
    table: "shops",
    targetColumns: [],
  });
});

test("a key's column keeps its reference through a rename, and loses it with the constraint", () => {
  const renamed = one(`
    CREATE TABLE orders (user_id uuid REFERENCES users(id));
    ALTER TABLE orders RENAME COLUMN user_id TO owner_id;
  `);
  assert.deepEqual(renamed.subjects[0].parts[0].ref?.columns, ["owner_id"]);
  const dropped = one(`
    CREATE TABLE orders (user_id uuid REFERENCES users(id));
    ALTER TABLE orders DROP CONSTRAINT orders_user_id_fkey;
  `);
  assert.equal(dropped.subjects[0].parts[0].ref, undefined);
});

test("a new table attaches to the existing table it references, shown as context", () => {
  const diagram = buildDiagram(
    one(`CREATE SCHEMA app; CREATE TABLE app.orders (id bigint PRIMARY KEY, user_id uuid REFERENCES users(id));`),
    [users],
  );
  assert.deepEqual(diagram.schemas, [
    { name: "public", status: "same" },
    { name: "app", status: "created" },
  ]);
  const orders = table(diagram.tables, "app.orders");
  assert.equal(orders.status, "created");
  assert.deepEqual(
    orders.columns.map((item) => [item.name, item.status, item.primaryKey, item.linked]),
    [
      ["id", "added", true, false],
      ["user_id", "added", false, true],
    ],
  );
  const context = table(diagram.tables, "public.users");
  assert.equal(context.status, "context");
  // Only the key the line lands on; the rest waits behind a count.
  assert.deepEqual(context.columns.map((item) => item.name), ["id"]);
  assert.deepEqual(context.hidden.map((item) => item.name), ["email", "name"]);
  assert.deepEqual(
    diagram.edges.map((edge) => [edge.from, edge.to, edge.status]),
    [["app.orders", "public.users", "added"]],
  );
});

test("an altered table lays the SQL over the database's columns", () => {
  const diagram = buildDiagram(
    one(`ALTER TABLE users ADD COLUMN age int; ALTER TABLE users DROP COLUMN name; ALTER TABLE users RENAME COLUMN email TO mail;`),
    [users],
  );
  const altered = table(diagram.tables, "public.users");
  assert.equal(altered.status, "altered");
  assert.deepEqual(
    altered.columns.map((item) => [item.name, item.status]),
    [
      ["id", "same"],
      ["mail", "renamed"],
      ["name", "dropped"],
      ["age", "added"],
    ],
  );
});

test("dropping a table drops the keys into it, and unrelated tables stay out", () => {
  const orders: TableInfo = {
    schema: "public",
    name: "orders",
    kind: "table",
    columns: [column("id", "bigint", true), column("user_id", "uuid")],
    foreignKeys: [
      { name: "orders_user_id_fkey", columns: ["user_id"], referencedTable: { schema: "public", name: "users" }, referencedColumns: ["id"] },
    ],
    referencedBy: [],
  };
  const lonely: TableInfo = { ...users, name: "lonely", referencedBy: [] };
  const withIncoming: TableInfo = {
    ...users,
    referencedBy: [
      { name: "orders_user_id_fkey", table: { schema: "public", name: "orders" }, columns: ["user_id"], referencedColumns: ["id"] },
    ],
  };
  const diagram = buildDiagram(one(`DROP TABLE users CASCADE;`), [withIncoming, orders, lonely]);
  assert.deepEqual(diagram.tables.map((item) => [item.id, item.status]), [
    ["public.users", "dropped"],
    ["public.orders", "context"],
  ]);
  assert.deepEqual(diagram.edges.map((edge) => edge.status), ["dropped"]);
  // A dropped table shows its keys, not every column it had.
  assert.deepEqual(table(diagram.tables, "public.users").columns.map((item) => item.name), ["id"]);
});

test("a key already in the database is not drawn twice once the migration is applied", () => {
  const applied: TableInfo = {
    schema: "public",
    name: "orders",
    kind: "table",
    columns: [column("id", "bigint", true), column("user_id", "uuid")],
    foreignKeys: [
      { name: "orders_user_id_fkey", columns: ["user_id"], referencedTable: { schema: "public", name: "users" }, referencedColumns: ["id"] },
    ],
    referencedBy: [],
  };
  const diagram = buildDiagram(
    one(`ALTER TABLE orders ADD CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);`),
    [users, applied],
  );
  assert.deepEqual(diagram.edges.map((edge) => edge.status), ["added"]);
});

test("focus brings forward only what the chosen files touched", () => {
  const changes = describeChanges([
    { version: "0001", sql: "CREATE TABLE a (id int PRIMARY KEY);" },
    { version: "0002", sql: "CREATE TABLE b (id int PRIMARY KEY, a_id int REFERENCES a);" },
  ]);
  const diagram = buildDiagram(changes, null, new Set(["0002"]));
  assert.equal(table(diagram.tables, "public.a").focused, false);
  assert.equal(table(diagram.tables, "public.b").focused, true);
  assert.equal(diagram.edges[0].focused, true);
  // No target columns: the line lands on the primary key.
  assert.equal(table(diagram.tables, "public.a").columns[0].linked, true);
});

test("a reference to a table nobody knows still has somewhere to land", () => {
  const diagram = buildDiagram(one(`CREATE TABLE b (a_id int REFERENCES elsewhere.a(code));`), null);
  const unknown = table(diagram.tables, "elsewhere.a");
  assert.equal(unknown.unknownColumns, true);
  assert.deepEqual(unknown.columns.map((item) => item.name), ["code"]);
});
