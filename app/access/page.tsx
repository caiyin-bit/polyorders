import AccessForm from "./access-form";

export const dynamic = "force-dynamic";

export default function AccessPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="font-mono text-xl font-bold tracking-tight">
        POLY<span className="text-accent">ORDERS</span>
      </h1>
      <p className="mt-1 text-xs text-mut">Polymarket 高胜率地址筛选终端</p>
      <AccessForm />
    </main>
  );
}
