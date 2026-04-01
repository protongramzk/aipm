// packages.js
// Helper system for package registry (Supabase)
// Assumes you already have supabase client exported

import { supabase } from './supabase.js'
import * as tar from 'tar'
import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
function buildTree(files, basePath) {
  const root = {};

  for (const file of files) {
    // 🔥 buang prefix basePath (x-wing/2.0.0)
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
function treeToArray(node) {
  return Object.values(node).map(item => ({
    name: item.name,
    type: item.type,
    fileUrl: item.fileUrl || null,
    children: item.children ? treeToArray(item.children) : []
  }));
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
        // 👉 folder → masukin aja ke recursion, JANGAN push
        await walk(fullPath);
      } else {
        // 👉 file only
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
// =============================
// UTIL
// =============================
function calcRank(stars, downloads) {
  return stars * 2 + downloads / 2
}

function pickLatestVersion(versions = []) {
  // simple semver sort (basic)
  return versions.sort((a, b) => {
    const pa = a.split('.').map(Number)
    const pb = b.split('.').map(Number)
    for (let i = 0; i < 3; i++) {
      if ((pa[i] || 0) > (pb[i] || 0)) return -1
      if ((pa[i] || 0) < (pb[i] || 0)) return 1
    }
    return 0
  })[0]
}

async function readMolFile(dir) {
  const yamlPath = path.join(dir, 'mol.yaml')
  const jsonPath = path.join(dir, 'mol.json')

  let data = null
  if (fs.existsSync(yamlPath)) {
    data = yaml.load(fs.readFileSync(yamlPath, 'utf-8'))
  } else if (fs.existsSync(jsonPath)) {
    data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'))
  }

  if (!data) throw new Error('mol file not found')
  if (!data.name ||!data.version) {
    throw new Error('invalid mol file (missing name/version)')
  }
  return data
}

// =============================
// GET ALL PACKAGES
// =============================
export async function getPackages({ type = 'feed', username } = {}) {
  let query = supabase.from('packages').select('*, accounts(username)')
  if (type === 'user' && username) {
    query = query.eq('accounts.username', username)
  }

  const { data, error } = await query
  if (error) throw error

  let result = data.map(p => ({
   ...p,
    rank: calcRank(p.stars_count || 0, p.downloads_count || 0)
  }))

  if (type === 'rank') {
    result.sort((a, b) => b.rank - a.rank)
  }
  if (type === 'feed') {
    result.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  }
  return result
}

// =============================
// UPLOAD PACKAGE
// =============================
export async function uploadPackage({ filePath, userId }) {
  const tempDir = `./tmp_${Date.now()}`
  try {
    fs.mkdirSync(tempDir)

    // extract tgz
    await tar.x({ file: filePath, cwd: tempDir })

    const mol = await readMolFile(tempDir)
    const { name, version, description } = mol

    // create package if not exist
    let { data: existing } = await supabase
     .from('packages')
     .select('*')
     .eq('name', name)
     .single()

    let packageId
    if (!existing) {
      const { data: newPkg, error } = await supabase
       .from('packages')
       .insert({
          name,
          description,
          publisher_id: userId,
          latest_version: version
        })
       .select()
       .single()
      if (error) throw error
      packageId = newPkg.id
    } else {
      packageId = existing.id
    }

    // insert version
    const { data: verData, error: verErr } = await supabase
     .from('package_versions')
     .insert({ package_id: packageId, version })
     .select()
     .single()
    if (verErr) throw verErr
    const versionId = verData.id

    // upload files to storage + insert metadata
    const files = []
    function walk(dir, base = '') {
      const items = fs.readdirSync(dir)
      for (const item of items) {
        const full = path.join(dir, item)
        const rel = path.join(base, item)
        if (fs.statSync(full).isDirectory()) {
          walk(full, rel)
        } else {
          files.push({ full, rel })
        }
      }
    }
    walk(tempDir)

    for (const f of files) {
      const buffer = fs.readFileSync(f.full)
      const storagePath = `${name}/${version}/${f.rel}`
      await supabase.storage.from('packages').upload(storagePath, buffer, { upsert: true })
      await supabase.from('package_files').insert({
        package_version_id: versionId,
        path: f.rel,
        size: buffer.length,
        content_hash: '',
        mime_type: ''
      })
    }

    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}
export async function getPackageDetail(name, version = 'latest') {
  const { data: pkg, error } = await supabase
    .from('packages')
    .select('*, accounts(username)')
    .eq('name', name)
    .single();

  if (error) throw error;

  const { data: versions } = await supabase
    .from('package_versions')
    .select('version')
    .eq('package_id', pkg.id);

  const versionList = versions.map(v => v.version);
  const finalVersion =
    version === 'latest' ? pickLatestVersion(versionList) : version;

  // 🔥 ambil semua file + folder recursive
const basePath = `${name}/${finalVersion}`;

const flatFiles = await listAllFiles('packages', basePath);

// 🔥 build tree
const treeObj = buildTree(flatFiles, basePath);
const tree = treeToArray(treeObj);
  // hitung atoms (file dalam folder atoms/)

  return {
    name: pkg.name,
    description: pkg.description,
    version: finalVersion,
    username: pkg.accounts?.username,
    created_at: pkg.created_at,
    stars: pkg.stars_count,
    downloads: pkg.downloads_count,
    atoms_count: 5,
    tree
  };
}
