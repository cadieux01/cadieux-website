import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Your Requests | Cadieux",
  description:
    "Track and manage the change requests you've submitted for your Cadieux orders and subscriptions.",
};

export default function RequestsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
