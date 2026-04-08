import { supabase } from './supabase.js'

// =============================
// SEMVER (SAFE FALLBACK)
// =============================

function calcTrendingScore(stars = 0, downloads = 0, createdAt) {
  const now = Date.now();
  const created = new Date(createdAt).getTime();

  const hours = (now - created) / (1000 * 60 * 60);

  const gravity = 1.5; // bisa tweak
  const ageFactor = Math.pow(hours + 2, gravity);

  return (stars * 3 + downloads) / ageFactor;
}
function parseSemver(v) {
  if (!v || typeof v !== 'string') return null;

  const match = v.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-.+)?$/);
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
    .filter(v => v.parsed);

  if (!parsed.length) return '0.0.1';

  parsed.sort((a, b) => compareSemver(a.parsed, b.parsed));
  return parsed[0].raw;
}

// =============================
// UTIL
// =============================
function calcRank(stars = 0, downloads = 0) {
  return stars * 2 + downloads / 2;
}

// =============================
// FAST STORAGE WALK (PARALLEL)
// =============================
async function listAllFiles(bucket, basePath) {
  const result = [];

  async function walk(path) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(path, { limit: 1000 });

    if (error) throw error;

    await Promise.all(
      data.map(async (item) => {
        const fullPath = path ? `${path}/${item.name}` : item.name;

        // In Supabase Storage list, folders have id=null or metadata=null
        if (item.id === null || item.metadata === null) {
          return walk(fullPath);
        }

        result.push({
          name: item.name,
          path: fullPath,
          fileUrl: supabase.storage
            .from(bucket)
            .getPublicUrl(fullPath).data.publicUrl
        });
      })
    );
  }

  await walk(basePath);
  return result;
}

// =============================
// TREE BUILDER (LEAN)
// =============================
function buildTree(files, basePath) {
  const root = {};

  for (const file of files) {
    const relative = file.path.slice(basePath.length + 1);
    const parts = relative.split('/');

    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isFile = i === parts.length - 1;

      if (!current[part]) {
        current[part] = isFile
          ? { name: part, type: 'file', fileUrl: file.fileUrl }
          : { name: part, type: 'folder', children: {} };
      }

      if (!isFile) current = current[part].children;
    }
  }

  return root;
}

function treeToArray(node) {
  return Object.values(node).map(item => ({
    name: item.name,
    type: item.type,
    fileUrl: item.fileUrl || null,
    children: item.children ? treeToArray(item.children) : []
  }));
}

// =============================
// GET ALL PACKAGES (⚡ 1 QUERY)
// =============================
export async function getPackages({ type = 'feed', username } = {}) {
  let query = supabase
    .from('packages')
    .select(`
      id,
      name,
      description,
      created_at,
      latest_version,
      visibility,
      stars_count,
      downloads_count,
      accounts!packages_publisher_id_fkey(username)
    `);

  // 🔐 FILTER USER
  if (type === 'user' && username) {
    query = query.eq('accounts.username', username);
  }

  const { data, error } = await query;
  if (error) throw error;

  let result = data.map(p => {
    const stars = p.stars_count || 0;
    const downloads = p.downloads_count || 0;

    return {
      id: p.id,
      name: p.name,
      description: p.description,
      username: p.accounts?.username,
      created_at: p.created_at,
      stars_count: stars,
      downloads_count: downloads,
      rank: calcRank(stars, downloads),
      trending: calcTrendingScore(stars, downloads, p.created_at), // 🔥 NEW
      latest_version: p.latest_version || '0.0.1',
      visibility: p.visibility
    };
  });

  // =========================
  // 🎯 SORTING
  // =========================
  if (type === 'rank') {
    result.sort((a, b) => b.rank - a.rank);

  } else if (type === 'trending'||type==='star') {
    result.sort((a, b) => b.trending - a.trending);

  } else {
    // default feed
    result.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  return result;
}

// =============================
// GET PACKAGES BY USERNAME
// =============================
export async function getPackagesByUsername(username) {
  const { data, error } = await supabase
    .from('packages')
    .select(`
      id,
      name,
      description,
      created_at,
      latest_version,
      stars_count,
      downloads_count,
      accounts!packages_publisher_id_fkey(username)
    `)
    .eq('accounts.username', username);

  if (error) throw error;

  return data
    .map(p => ({
      id: p.id,
      name: p.name,
      description: p.description,
      created_at: p.created_at,
      stars_count: p.stars_count || 0,
      downloads_count: p.downloads_count || 0,
      rank: calcRank(p.stars_count, p.downloads_count),
      latest_version: p.latest_version || '0.0.1'
    }))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

// =============================
// GET PACKAGE DETAIL (SMART)
// =============================
export async function getPackageDetail(name, version = 'latest') {
  const { data: pkg, error } = await supabase
    .from('packages')
    .select(`
      id,
      name,
      description,
      created_at,
      latest_version,
      stars_count,
      downloads_count,
      accounts(username)
    `)
    .eq('name', name)
    .single();

  if (error) throw error;
  if (!pkg) throw new Error('Package not found');

  let finalVersion = version;

  // ⚡ FAST PATH
  if (version === 'latest') {
    if (pkg.latest_version) {
      finalVersion = pkg.latest_version;
    } else {
      // 🧠 FALLBACK ke semver (rare case)
      const { data: versions } = await supabase
        .from('package_versions')
        .select('version')
        .eq('package_id', pkg.id);

      const versionList = versions?.map(v => v.version) || [];
      finalVersion = pickLatestVersion(versionList);
    }
  }

  if (!finalVersion) finalVersion = '0.0.1';

  const basePath = `${name}/${finalVersion}`;

  const flatFiles = await listAllFiles('packages', basePath);
  const tree = treeToArray(buildTree(flatFiles, basePath));

  let atomsCount = 0;
  for (const f of flatFiles) {
    if (f.path.startsWith(`${basePath}/atoms/`)) atomsCount++;
  }

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
    rank: calcRank(pkg.stars_count, pkg.downloads_count),
    tree
  };
}
