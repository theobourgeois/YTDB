import { MigrationDetail } from "@/components/migrations/migration-detail";

/**
 * One migration. Its files, schema and timeline are child pages of their own,
 * so back and forward step between them, while the view lives here and keeps
 * its open rows, selection and loaded ledgers across the switch.
 */
export default async function MigrationLayout({
  children,
  params,
}: LayoutProps<"/[connectionId]/migrations/[setId]">) {
  const { setId } = await params;
  return (
    <>
      <MigrationDetail setId={decodeURIComponent(setId)} />
      {children}
    </>
  );
}
