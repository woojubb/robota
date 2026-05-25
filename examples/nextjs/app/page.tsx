import Chat from '../components/chat';

export default function Page() {
  return (
    <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', padding: 16 }}>
      <Chat />
    </main>
  );
}
