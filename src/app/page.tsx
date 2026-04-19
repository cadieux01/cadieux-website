import ClientOnly from "@/components/ClientOnly";
import ClientApp from "./components/ClientApp";

// Server Component — renders nothing on the server (ClientOnly returns null),
// then mounts the full client app after hydration. No dynamic() needed.
export default function Home() {
  return (
    <ClientOnly>
      <ClientApp />
    </ClientOnly>
  );
}
