import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AEC Drafting Pilot",
  description: "Source-grounded document drafting pilot (development build)",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col font-sans">
        <div className="bg-amber-100 px-4 py-1 text-center text-xs font-semibold uppercase tracking-wide text-amber-900">
          Development build — synthetic data only, not for confidential documents
        </div>
        {children}
      </body>
    </html>
  );
}
