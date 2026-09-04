export default function GuestBillNotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10 text-center">
      <h1 className="text-2xl font-bold tracking-tight">This link does not work</h1>
      <p className="mt-3 text-[15px]" style={{ color: 'var(--text-muted)' }}>
        It may have been mistyped, or the person who paid may have deleted the bill. Ask them to
        send it again.
      </p>
    </main>
  );
}
