import { ExplorerShell } from "@/components/explorer/explorer-shell";

export default async function ConnectionLayout({
  children,
  params,
}: LayoutProps<"/[connectionId]">) {
  const { connectionId } = await params;
  return <ExplorerShell connectionId={connectionId}>{children}</ExplorerShell>;
}
