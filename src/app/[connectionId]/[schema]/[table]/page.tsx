import { TableView } from "@/components/table/table-view";

export default async function TablePage({ params }: PageProps<"/[connectionId]/[schema]/[table]">) {
  const { schema, table } = await params;
  return <TableView table={{ schema: decodeURIComponent(schema), name: decodeURIComponent(table) }} />;
}
