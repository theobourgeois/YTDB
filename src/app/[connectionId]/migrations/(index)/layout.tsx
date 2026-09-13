import { MigrationsIndex } from "@/components/migrations/migrations-index";

/** The list of migrations and its timeline, each a page of its own, sharing one mounted view. */
export default function MigrationsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MigrationsIndex />
      {children}
    </>
  );
}
