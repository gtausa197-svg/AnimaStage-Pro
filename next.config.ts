import type {NextConfig} from 'next';
import fs from 'fs';
import path from 'path';

function symlinkSyncSafe(src: string, dest: string) {
  try {
    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    let exists = false;
    try {
      fs.lstatSync(dest);
      exists = true;
    } catch {
      // doesn't exist
    }

    if (exists) {
      fs.rmSync(dest, { recursive: true, force: true });
    }

    const target = path.relative(path.dirname(dest), src);
    const isDir = fs.statSync(src).isDirectory();
    fs.symlinkSync(target, dest, isDir ? 'dir' : 'file');
  } catch (error) {
    console.error(`Failed to symlink ${src} to ${dest}:`, error);
  }
}

/** Prefer parent workspace copies (latest edits), fall back to files inside New Folder */
function resolveStudioAsset(name: string) {
  const projectRoot = process.cwd();
  const parent = path.join(projectRoot, '..', name);
  const local = path.join(projectRoot, name);
  if (fs.existsSync(parent)) return parent;
  if (fs.existsSync(local)) return local;
  return null;
}

function setupPublicStudioLinks() {
  const publicDir = path.join(process.cwd(), 'public');
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  for (const name of ['mmd_rtx.html', 'mmd-character-motion.js']) {
    const src = resolveStudioAsset(name);
    if (src) {
      symlinkSyncSafe(src, path.join(publicDir, name));
    }
  }

  const vendorSrc = resolveStudioAsset('vendor');
  if (vendorSrc) {
    symlinkSyncSafe(vendorSrc, path.join(publicDir, 'vendor'));
  }
}

try {
  setupPublicStudioLinks();
} catch (error) {
  console.error('Error setting up public studio links:', error);
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
    ],
  },
  output: 'standalone',
  transpilePackages: ['motion'],
  webpack: (config, {dev}) => {
    if (dev && process.env.DISABLE_HMR === 'true') {
      config.watchOptions = {
        ignored: /.*/,
      };
    }
    return config;
  },
};

export default nextConfig;
