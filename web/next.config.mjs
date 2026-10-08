/** @type {import('next').NextConfig} */
const nextConfig = {
  // "export" makes `next build` write plain HTML/JS/CSS files into web/out, with no server.
  // That is what lets us host the site on S3 + CloudFront for almost nothing.
  output: 'export',
  // The shared package is TypeScript source, so Next must compile it too.
  transpilePackages: ['@fixitfast/shared'],
  reactStrictMode: true,
};

export default nextConfig;
