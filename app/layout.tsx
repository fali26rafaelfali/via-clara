import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vía Clara · Navegación a tu manera",
  description: "Rutas tranquilas, rápidas o ecológicas para cada viaje.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
