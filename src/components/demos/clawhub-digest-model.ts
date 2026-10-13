/** Source-derived fixture for ClawHub fb0ef1d; it never calls a deployment. */
export const CLAWHUB_REVISION = 'fb0ef1d21eab78ad2b9da69f48045d7747cc73c1';
export const SOURCE_ROOT = `https://github.com/openclaw/clawhub/blob/${CLAWHUB_REVISION}/`;
export type VersionId = 'skillVersions:v1' | 'skillVersions:v2';
export interface CatalogConditions {
  v2Review: 'pending' | 'public';
  v1Withdrawn: boolean;
  hidden: boolean;
}
export interface SkillRecord {
  _id: string; slug: string; displayName: string; summary: string;
  ownerPublisherId: string; ownerUserId: string;
  latestVersionId: VersionId; latestVersionSummary: {version: string; createdAt: number; changelog: string};
  moderationSourceVersionId: VersionId;
  moderationStatus: 'active' | 'hidden'; moderationReason: string;
  softDeletedAt?: number; moderationVerdict?: string; moderationFlags: string[];
  installKind?: 'github'; stats: {versions: number};
}
export interface VersionRecord {
  _id: VersionId; skillId: string; version: string; createdAt: number; changelog: string;
  publicationStatus: 'published'; softDeletedAt?: number;
  vtAnalysis: {status: string}; staticScan: {status: string}; llmAnalysis: {status: string; verdict?: string};
}
export type PublicVersionState = {status: 'available'; versionId: VersionId} | {status: 'unavailable'};
type BrowseVisibility = Pick<SkillRecord, 'softDeletedAt' | 'moderationStatus' | 'moderationVerdict' | 'moderationFlags' | 'moderationReason' | 'installKind' | 'stats'>;
export interface SkillDigest extends Pick<SkillRecord, 'slug' | 'displayName' | 'summary' | 'ownerPublisherId' | 'ownerUserId' | 'latestVersionId' | 'latestVersionSummary' | 'softDeletedAt' | 'moderationStatus' | 'moderationVerdict' | 'moderationFlags' | 'moderationReason' | 'installKind' | 'stats'> {
  skillId: string; latestVersionSkillId: string; ownerHandle: string; ownerDisplayName: string;
  publicVersion: PublicVersionState;
}
export interface PublicEntry {
  skill: {displayName: string; summary: string; slug: string; latestVersionId: VersionId};
  latestVersion: {id: VersionId; version: string; changelog: string};
  ownerDisplayName: string;
  hydration: 'digest-summary' | 'public-version-read';
}
export interface CatalogState {
  conditions: CatalogConditions; skill: SkillRecord; versions: VersionRecord[];
  digest: SkillDigest; entry: PublicEntry | null;
  outcome: 'v1' | 'v2' | 'no-public-version' | 'hidden';
  explanation: string; selectorPosition: number;
}
export const INITIAL_CONDITIONS: CatalogConditions = {v2Review: 'pending', v1Withdrawn: false, hidden: false};

export function createCatalogFixture(conditions: CatalogConditions = INITIAL_CONDITIONS) {
  const skill: SkillRecord = {
    _id: 'skills:field-notes', slug: 'field-notes', displayName: 'Field Notes · 新版卡片',
    summary: '新增模板的说明；这是父 Skill 当前摘要。',
    ownerPublisherId: 'publishers:field-guide', ownerUserId: 'users:editor',
    latestVersionId: 'skillVersions:v2',
    latestVersionSummary: {version: '2.0.0', createdAt: 200, changelog: 'v2：新增模板'},
    moderationSourceVersionId: 'skillVersions:v2',
    moderationStatus: conditions.hidden ? 'hidden' : 'active',
    moderationReason: conditions.v2Review === 'pending' ? 'pending.scan' : 'scanner.llm.clean',
    softDeletedAt: conditions.hidden ? 300 : undefined,
    moderationVerdict: conditions.v2Review === 'public' ? 'clean' : undefined,
    moderationFlags: [], stats: {versions: 2},
  };
  const versions: VersionRecord[] = [
    {_id: 'skillVersions:v1', skillId: skill._id, version: '1.0.0', createdAt: 100,
      changelog: 'v1：基础模板', publicationStatus: 'published',
      softDeletedAt: conditions.v1Withdrawn ? 250 : undefined,
      vtAnalysis: {status: 'clean'}, staticScan: {status: 'clean'}, llmAnalysis: {status: 'clean', verdict: 'benign'}},
    {_id: 'skillVersions:v2', skillId: skill._id, version: '2.0.0', createdAt: 200,
      changelog: 'v2：新增模板', publicationStatus: 'published',
      vtAnalysis: {status: 'clean'}, staticScan: {status: 'clean'},
      llmAnalysis: conditions.v2Review === 'pending' ? {status: 'pending'} : {status: 'clean', verdict: 'benign'}},
  ];
  return {skill, versions};
}

/** securityScanPolicy.ts:13–34, including benign and absent/unknown statuses. */
export function normalizeScanStatus(status: string | undefined): string | undefined {
  const normalized = status?.trim().toLowerCase();
  if (normalized === 'benign') return 'clean';
  return ['clean', 'suspicious', 'malicious', 'pending', 'failed', 'not-run'].includes(normalized ?? '') ? normalized : undefined;
}
/** publicBrowse.ts:90–101; this predicate alone does not establish Skill visibility. */
export function isListableVersion(version: VersionRecord | null | undefined): boolean {
  if (!version || version.softDeletedAt) return false;
  const statuses = [version.vtAnalysis?.status, version.llmAnalysis?.verdict ?? version.llmAnalysis?.status, version.staticScan?.status].map(normalizeScanStatus);
  return !statuses.some(status => status === 'pending' || status === 'not-run' || status === 'failed' || status === 'malicious');
}
export function isPendingReview(skill: Pick<SkillRecord, 'moderationReason'>): boolean {
  return ['pending.scan', 'pending.scan.stale', 'scanner.vt.pending', 'scanner.llm.pending'].includes(skill.moderationReason.trim().toLowerCase());
}
export function excludedFromBrowse(skill: BrowseVisibility): boolean {
  const suspicious = skill.moderationFlags.includes('flagged.suspicious')
    || (skill.moderationReason.startsWith('scanner.') && skill.moderationReason.endsWith('.suspicious'));
  return Boolean(skill.softDeletedAt) || skill.moderationStatus !== 'active'
    || skill.moderationVerdict === 'malicious' || skill.moderationFlags.includes('blocked.malware') || suspicious
    || (skill.installKind !== 'github' && isPendingReview(skill) && skill.stats.versions <= 1);
}

/** Mirrors publicBrowse.ts:123–166 over explicit in-memory source rows. */
export function selectPublicVersion(skill: SkillRecord, versions: VersionRecord[]): PublicVersionState {
  if (excludedFromBrowse(skill)) return {status: 'unavailable'};
  if (!isPendingReview(skill)) {
    const latest = versions.find(version => version._id === skill.latestVersionId);
    return latest?.skillId === skill._id && isListableVersion(latest)
      ? {status: 'available', versionId: latest._id} : {status: 'unavailable'};
  }
  if (skill.installKind === 'github' || skill.stats.versions <= 1) return {status: 'unavailable'};
  const candidates = versions.filter(version => version.skillId === skill._id && version.softDeletedAt === undefined)
    .sort((a, b) => b.createdAt - a.createdAt).slice(0, 2);
  const available = candidates.find(version => version._id !== skill.moderationSourceVersionId && isListableVersion(version));
  return available ? {status: 'available', versionId: available._id} : {status: 'unavailable'};
}

export function projectSkillDigest(skill: SkillRecord, versions: VersionRecord[]): SkillDigest {
  return {
    skillId: skill._id, slug: skill.slug, displayName: skill.displayName, summary: skill.summary,
    ownerPublisherId: skill.ownerPublisherId, ownerUserId: skill.ownerUserId,
    latestVersionId: skill.latestVersionId, latestVersionSkillId: skill._id,
    latestVersionSummary: {...skill.latestVersionSummary},
    softDeletedAt: skill.softDeletedAt, moderationStatus: skill.moderationStatus,
    moderationVerdict: skill.moderationVerdict, moderationFlags: [...skill.moderationFlags],
    moderationReason: skill.moderationReason, installKind: skill.installKind, stats: {...skill.stats},
    ownerHandle: 'field-guide', ownerDisplayName: 'Field Guide',
    publicVersion: selectPublicVersion(skill, versions),
  };
}
/** skills.ts:6147–6259. Card metadata stays on the parent; version metadata can fall back. */
export function hydratePublicEntry(digest: SkillDigest, versions: VersionRecord[]): PublicEntry | null {
  if (excludedFromBrowse(digest) || digest.publicVersion.status === 'unavailable') return null;
  const id = digest.publicVersion.versionId;
  const summary = id === digest.latestVersionId && digest.latestVersionSkillId === digest.skillId
    ? digest.latestVersionSummary : null;
  if (summary) return {
    skill: {displayName: digest.displayName, summary: digest.summary, slug: digest.slug, latestVersionId: digest.latestVersionId},
    latestVersion: {id, version: summary.version, changelog: summary.changelog},
    ownerDisplayName: digest.ownerDisplayName, hydration: 'digest-summary',
  };
  const version = versions.find(row => row._id === id);
  if (!version || version.softDeletedAt || version.publicationStatus !== 'published' || version.skillId !== digest.skillId) return null;
  return {
    skill: {displayName: digest.displayName, summary: digest.summary, slug: digest.slug, latestVersionId: digest.latestVersionId},
    latestVersion: {id, version: version.version, changelog: version.changelog},
    ownerDisplayName: digest.ownerDisplayName, hydration: 'public-version-read',
  };
}

export function catalogState(conditions: CatalogConditions = INITIAL_CONDITIONS): CatalogState {
  const {skill, versions} = createCatalogFixture(conditions);
  const digest = projectSkillDigest(skill, versions);
  const entry = hydratePublicEntry(digest, versions);
  const outcome = conditions.hidden ? 'hidden' : entry?.latestVersion.id === 'skillVersions:v1' ? 'v1'
    : entry?.latestVersion.id === 'skillVersions:v2' ? 'v2' : 'no-public-version';
  const explanation = outcome === 'v1'
    ? 'v2 已发布但扫描待审。公开版本选择跳过 moderationSourceVersionId=v2，目录展示 v1；标题与摘要仍来自父 Skill 的 digest。'
    : outcome === 'v2' ? 'v2 满足公开条件，父 Skill 的待审状态也已同步。publicVersion 指向 latest v2，列表可直接使用 digest 内的版本摘要。'
      : outcome === 'hidden' ? 'Skill 已隐藏。digest 仍保存最新指针与 unavailable 状态，公开列表不会返回这一项；没有删除源档案或 digest。'
        : 'v2 待审且 v1 已撤下，没有合格候选。digest.publicVersion 为 unavailable，公开列表不返回这一项。';
  return {conditions: {...conditions}, skill, versions, digest, entry, outcome, explanation,
    selectorPosition: outcome === 'v1' ? 0 : outcome === 'v2' ? 20 : 40};
}
