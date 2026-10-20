import { test } from "node:test";
import assert from "node:assert/strict";
import { dropSortWhenUnscoped, type TableQueryScope } from "../src/lib/table-state";

const base: TableQueryScope = {
  filters: [{ id: "1", column: "creator_id", operator: "eq", value: "42" }],
  search: "",
  sort: { column: "created_at", direction: "desc" },
};

test("clearing the last filter drops a leftover sort so it cannot scan the whole table", () => {
  const next = dropSortWhenUnscoped(base, { filters: [] });
  assert.equal(next.sort, null);
  assert.deepEqual(next.filters, []);
});

test("clearing search while unfiltered also drops the sort", () => {
  const current: TableQueryScope = { ...base, filters: [], search: "hello" };
  assert.equal(dropSortWhenUnscoped(current, { search: "" }).sort, null);
});

test("removing one filter while another remains keeps the sort", () => {
  const current: TableQueryScope = {
    ...base,
    filters: [...base.filters, { id: "2", column: "platform", operator: "eq", value: "tiktok" }],
  };
  const next = dropSortWhenUnscoped(current, { filters: base.filters });
  assert.equal(next.sort, undefined);
});

test("an explicit column-header sort is left alone", () => {
  const current: TableQueryScope = { ...base, filters: [], sort: null };
  const sort = { column: "created_at", direction: "desc" as const };
  assert.equal(dropSortWhenUnscoped(current, { sort }).sort, sort);
});
