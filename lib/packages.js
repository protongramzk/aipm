// packages.js
// Helper system for package registry (Supabase)
import { supabase } from './supabase.js'
// ==========================================
// 1. TUKANG GALI FILE (Recursive List)
// ==========================================
// Fungsi ini bakal masuk terus ke dalam folder sampai nemu file mentok

// =============================
// SEMVER UTILS (CUSTOM)
// =============================
function parseSemver(v) {
  if (!v || typeof v !== 'string') return null;

  const match = v.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}

function compareSemver(a, b) {
  if (a.major !== b.major) return b.major - a.major;
  if (a.minor !== b.minor) return b.minor - a.minor;
  return b.patch - a.patch;
}

function pickLatestVersion(versions = []) {
  const parsed = versions
    .map(v => ({ raw: v, parsed: parseSemver(v) }))
    .filter(v => v.parsed !== null);

  if (parsed.length === 0) {
    return '0.0.1'; // 🔥 fallback minimal
  }

  parsed.sort((a, b) => compareSemver(a.parsed, b.parsed));

  return parsed[0].raw;
}
async function listAllFiles(bucket, basePath) {
  let result = [];

  async function walk(path) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(path, { limit: 1000 });

    if (error) throw error;

    for (const item of data) {
      const fullPath = path ? `${path}/${item.name}` : item.name;

      if (item.metadata === null) {
        // 👉 Kalau dia folder (metadata null), gali lagi ke dalem!
        await walk(fullPath);
      } else {
        // 👉 Kalau dia file, ambil Public URL-nya terus simpan
        result.push({
          name: item.name,
          path: fullPath,
          type: 'file',
          fileUrl: supabase.storage
            .from(bucket)
            .getPublicUrl(fullPath).data.publicUrl
        });
      }
    }
  }

  await walk(basePath);
  return result;
}


// ==========================================
// 2. TUKANG RAKIT OBJEK (Build Tree)
// ==========================================
// Ngubah list file yang datar jadi punya hirarki parent-child
function buildTree(files, basePath) {
  const root = {};

  for (const file of files) {
    // 🔥 Buang prefix basePath (misal buang "nama-package/1.0.0/")
    // Biar namanya bersih pas ditampilin
    const relative = file.path.replace(basePath + '/', '');
    const parts = relative.split('/');

    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;

      if (!current[part]) {
        current[part] = {
          name: part,
          type: isFile ? 'file' : 'folder',
          children: isFile ? undefined : {},
          fileUrl: isFile ? file.fileUrl : undefined
        };
      }

      if (!isFile) {
        current = current[part].children;
      }
    }
  }

  return root;
}


// ==========================================
// 3. TUKANG POLES AKHIR (Tree to Array)
// ==========================================
// Karena frontend (React/Vue/Svelte) lebih gampang nge-map Array,
// kita ubah objek tree tadi jadi array beneran.
function treeToArray(node) {
  return Object.values(node).map(item => ({
    name: item.name,
    type: item.type,
    fileUrl: item.fileUrl || null,
    // Kalau ada anak (folder), panggil fungsi ini lagi buat anaknya
    children: item.children ? treeToArray(item.children) : []
  }));
}
// =============================
// UTIL
// =============================
function calcRank(stars, downloads) {
  return stars * 2 + downloads / 2
}


// =============================
// GET ALL PACKAGES
// =============================
export async function getPackages({ type = 'feed', username } = {}) {
  // ambil semua packages + publisher username
  const { data: pkgs, error } = await supabase
    .from('packages')
    .select(`
      *,
      accounts!packages_publisher_id_fkey(username)
    `);

  if (error) throw error;

  const result = await Promise.all(pkgs.map(async p => {
    // hitung stars_count
    const { count: starsCount } = await supabase
      .from('package_stars')
      .select('*', { count: 'exact', head: true })
      .eq('package_id', p.id);

    // hitung downloads_count
    const { count: downloadsCount } = await supabase
      .from('download_logs')
      .select('*', { count: 'exact', head: true })
      .eq('package_id', p.id);

    // hitung atoms_count (jumlah file di latest version)
    const { data: files } = await supabase
      .from('package_versions')
      .select('id')
      .eq('package_id', p.id)
      .order('created_at', { ascending: false })
      .limit(1);
    
    let atomsCount = 0;
    if (files?.[0]) {
      const { data: pf } = await supabase
        .from('package_files')
        .select('id')
        .eq('package_version_id', files[0].id);
      atomsCount = pf?.length || 0;
    }

    return {
      id: p.id,
      name: p.name,
      description: p.description,
      username: p.accounts?.username,
      created_at: p.created_at,
      stars_count: starsCount,
      downloads_count: downloadsCount,
      atoms_count: atomsCount,
      rank: starsCount * 2 + downloadsCount / 2,
      latest_version: p.latest_version,
      visibility: p.visibility || 'public'
    };
  }));

  if (type === 'rank') {
    result.sort((a, b) => b.rank - a.rank);
  }
  if (type === 'feed') {
    result.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  return result;
}
// =============================
// GET PACKAGES BY USERNAME
// =============================
export async function getPackagesByUsername(username) {
  // cari user dulu
  const { data: user, error: userError } = await supabase
    .from('accounts')
    .select('id')
    .eq('username', username)
    .single();

  if (userError) throw userError;
  if (!user) throw new Error('User not found');

  // ambil semua package milik dia
  const { data: pkgs, error } = await supabase
    .from('packages')
    .select('*')
    .eq('publisher_id', user.id);

  if (error) throw error;

  const result = await Promise.all(pkgs.map(async p => {
    const { count: starsCount } = await supabase
      .from('package_stars')
      .select('*', { count: 'exact', head: true })
      .eq('package_id', p.id);

    const { count: downloadsCount } = await supabase
      .from('download_logs')
      .select('*', { count: 'exact', head: true })
      .eq('package_id', p.id);

    return {
      id: p.id,
      name: p.name,
      description: p.description,
      created_at: p.created_at,
      stars_count: starsCount,
      downloads_count: downloadsCount,
      rank: starsCount * 2 + downloadsCount / 2,
      latest_version: p.latest_version
    };
  }));

  return result.sort((a, b) =>
    new Date(b.created_at) - new Date(a.created_at)
  );
}
// =============================
// GET PACKAGE DETAIL (WITH TREE)
// =============================
export async function getPackageDetail(name, version = 'latest') {
  const { data: pkg, error } = await supabase
    .from('packages')
    .select('*, accounts(username)')
    .eq('name', name)
    .single();

  if (error) throw error;
  if (!pkg) throw new Error('Package not found');

  const { data: versions } = await supabase
    .from('package_versions')
    .select('version')
    .eq('package_id', pkg.id);

  const versionList = versions?.map(v => v.version) || [];

  const finalVersion = version === 'latest'
    ? pickLatestVersion(versionList)
    : version || '0.0.1'; // 🔥 fallback juga di sini

  const basePath = `${name}/${finalVersion}`;

  const flatFiles = await listAllFiles('packages', basePath);

  const treeObj = buildTree(flatFiles, basePath);
  const tree = treeToArray(treeObj);

  const atomsCount = flatFiles.filter(f =>
    f.path.includes(`${basePath}/atoms/`)
  ).length;

  return {
    id: pkg.id,
    name: pkg.name,
    description: pkg.description,
    version: finalVersion,
    username: pkg.accounts?.username,
    created_at: pkg.created_at,
    stars_count: pkg.stars_count || 0,
    downloads_count: pkg.downloads_count || 0,
    atoms_count: atomsCount,
    rank: (pkg.stars_count || 0) * 2 + (pkg.downloads_count || 0) / 2,
    tree
  };
}

