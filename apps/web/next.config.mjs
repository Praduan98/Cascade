/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@cascade/ui', '@cascade/core', '@cascade/data', '@cascade/grid'],
}

export default nextConfig
