import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tistory Auto · 백오피스",
  description:
    "매일 오전 9시, AI가 만든 SEO 최적화 블로그 글 10개를 받아 보세요.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
