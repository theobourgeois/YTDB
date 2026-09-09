import { MigrationDetail } from "@/components/migrations/migration-detail";

export default async function MigrationPage({
  params,
}: PageProps<"/[connectionId]/migrations/[setId]">) {
  const { setId } = await params;
  return <MigrationDetail setId={decodeURIComponent(setId)} />;
}
