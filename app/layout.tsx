import type { Metadata } from "next";
import "./globals.css";
import "maplibre-gl/dist/maplibre-gl.css";

export const metadata: Metadata = {
  title: "Vía Clara · Navegación a tu manera",
  description: "Mapa, GPS y rutas reales tranquilas, rápidas o ecológicas.",
  openGraph: {
    title: "Vía Clara",
    description: "Llega bien, no solo rápido.",
    images: [{ url: "/og.png", width: 1536, height: 1024, alt: "Vía Clara, navegación a tu manera" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Vía Clara",
    description: "Llega bien, no solo rápido.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
