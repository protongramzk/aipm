// packages.js
// Helper system for package registry (Supabase)
// Assumes you already have supabase client exported
import fs from 'fs'
import { supabase } from './supabase.js'
import tar from 'tar-stream'
import zlib from 'node:zlib'
import yaml from 'js-yaml'
import { Readable } from 'node:stream'
import path from 'node:path'
import crypto from 'node:crypto'
export async function readMolBuffer(buffer) {
  const text = buffer.toString('utf-8')

  try {
    if (text.trim().startsWith('{')) {
      return JSON.parse(text)
    } else {
      return yaml.load(text)
    }
  } catch (err) {
    throw new Error('mol.json / mol.yaml invalid')
  }
}
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
// 📦 EXTRACT TGZ (PURE MEMORY)
// =============================
async function extractTgz(buffer) {
  const extract = tar.extract()
  const files = []

  return new Promise((resolve, reject) => {
    extract.on('entry', (header, stream, next) => {
      if (header.type !== 'file') {
        stream.resume()
        return next()
      }

      const chunks = []

      stream.on('data', (chunk) => chunks.push(chunk))

      stream.on('end', () => {
        files.push({
          path: header.name,
          buffer: Buffer.concat(chunks)
        })
        next()
      })

      stream.on('error', reject)
    })

    extract.on('finish', () => resolve(files))
    extract.on('error', reject)

    Readable.from(buffer)
      .pipe(zlib.createGunzip())
      .pipe(extract)
  })
}

// =============================
// 🔐 HASH (biar future-proof)
// =============================
function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

// =============================
// 📦 UPLOAD PACKAGE
// =============================
export async function uploadPackage({ buffer, userId }) {
  try {
    // 1. Extract semua file
    const files = await extractTgz(buffer)

    if (!files.length) {
      throw new Error('TGZ kosong')
    }

    // 2. Cari mol config
    const molFile = files.find(f =>
      f.path.endsWith('mol.json') || f.path.endsWith('mol.yaml')
    )

    if (!molFile) {
      throw new Error('mol.json / mol.yaml tidak ditemukan')
    }

    const mol = await readMolBuffer(molFile.buffer)
    const { name, version, description } = mol

    if (!name || !version) {
      throw new Error('mol invalid (name/version wajib)')
    }

    // 3. Upsert package
    let { data: pkg } = await supabase
      .from('packages')
      .select('*')
      .eq('name', name)
      .single()

    let packageId

    if (!pkg) {
      const { data, error } = await supabase
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
      packageId = data.id
    } else {
      packageId = pkg.id
    }

    // 4. Insert version
    const { data: verData, error: verErr } = await supabase
      .from('package_versions')
      .insert({
        package_id: packageId,
        version
      })
      .select()
      .single()

    if (verErr) throw verErr
    const versionId = verData.id

    // 5. Upload files (PARALLEL 🔥)
    await Promise.all(
      files.map(async (f) => {
        const cleanPath = f.path.replace(/^package\//, '')
        const storagePath = `${name}/${version}/${cleanPath}`

        const hash = sha256(f.buffer)

        // upload ke storage
        const { error: uploadErr } = await supabase.storage
          .from('packages')
          .upload(storagePath, f.buffer, {
            upsert: true,
            contentType: 'application/octet-stream'
          })

        if (uploadErr) throw uploadErr

        // insert metadata
        const { error: dbErr } = await supabase
          .from('package_files')
          .insert({
            package_version_id: versionId,
            path: cleanPath,
            size: f.buffer.length,
            content_hash: hash,
            mime_type: '' // bisa improve nanti
          })

        if (dbErr) throw dbErr
      })
    )

    // 6. Update latest version
    await supabase
      .from('packages')
      .update({ latest_version: version })
      .eq('id', packageId)

    return {
      success: true,
      package: { name, version },
      files: files.length
    }

  } catch (err) {
    return {
      success: false,
      error: err.message
    }
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
