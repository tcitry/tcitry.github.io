import test from 'node:test';
import assert from 'node:assert/strict';
import {stripTypeScriptTypes} from 'node:module';
import {
  catalogState, createCatalogFixture, selectPublicVersion, projectSkillDigest,
  hydratePublicEntry, isListableVersion, normalizeScanStatus,
} from '../src/components/demos/clawhub-digest-model.ts';

// Exact pure resolver excerpts from openclaw/clawhub fb0ef1d21eab78ad2b9da69f48045d7747cc73c1.
// convex/lib/publicBrowse.ts:43–101,123–167; globalStats.ts:20–28;
// skillSafety.ts:22–37; securityScanPolicy.ts:11–35. Local fixture DB only.
const UPSTREAM_TS = "export function isPublicSkillDoc<T extends SkillVisibilityFields>(\n  skill: T | null | undefined,\n): skill is T {\n  if (!skill || skill.softDeletedAt) return false;\n  if (skill.moderationStatus && skill.moderationStatus !== \"active\") return false;\n  if (skill.moderationVerdict === \"malicious\") return false;\n  if (skill.moderationFlags?.includes(\"blocked.malware\")) return false;\n  return true;\n}\n\nfunction isScannerSuspiciousReason(reason: string | undefined) {\n  if (!reason) return false;\n  return reason.startsWith(\"scanner.\") && reason.endsWith(\".suspicious\");\n}\n\nfunction isScannerMaliciousReason(reason: string | undefined) {\n  if (!reason) return false;\n  return reason.startsWith(\"scanner.\") && reason.endsWith(\".malicious\");\n}\n\nexport function isSkillSuspicious(\n  skill: Pick<Doc<\"skills\">, \"moderationFlags\" | \"moderationReason\">,\n) {\n  if (skill.moderationFlags?.includes(\"flagged.suspicious\")) return true;\n  return isScannerSuspiciousReason(skill.moderationReason);\n}\n\nconst BLOCKED_PUBLIC_SECURITY_SCAN_STATUSES = new Set<SecurityScanStatus>([\"failed\", \"malicious\"]);\n\nexport function normalizeSecurityScanStatus(\n  status: string | null | undefined,\n): SecurityScanStatus | undefined {\n  const normalized = status?.trim().toLowerCase();\n  if (normalized === \"benign\") return \"clean\";\n  if (\n    normalized === \"clean\" ||\n    normalized === \"suspicious\" ||\n    normalized === \"malicious\" ||\n    normalized === \"pending\" ||\n    normalized === \"failed\" ||\n    normalized === \"not-run\"\n  ) {\n    return normalized;\n  }\n  return undefined;\n}\n\nexport function isSecurityScanStatusBlockedFromPublic(\n  status: SecurityScanStatus | null | undefined,\n): boolean {\n  return Boolean(status && BLOCKED_PUBLIC_SECURITY_SCAN_STATUSES.has(status));\n}\n\nfunction isPendingSkillModerationReason(reason: string | null | undefined) {\n  const normalized = reason?.trim().toLowerCase();\n  return (\n    normalized === \"pending.scan\" ||\n    normalized === \"pending.scan.stale\" ||\n    normalized === \"scanner.vt.pending\" ||\n    normalized === \"scanner.llm.pending\"\n  );\n}\n\nexport function isSkillPendingPublicReview(\n  skill: Pick<Doc<\"skills\">, \"moderationStatus\" | \"moderationReason\" | \"moderationFlags\">,\n) {\n  return isPendingSkillModerationReason(skill.moderationReason);\n}\n\nexport function isHostedSkillPendingPublicReview(\n  skill: Pick<\n    Doc<\"skills\">,\n    \"installKind\" | \"moderationStatus\" | \"moderationReason\" | \"moderationFlags\"\n  >,\n) {\n  return skill.installKind !== \"github\" && isSkillPendingPublicReview(skill);\n}\n\nexport function isHostedSkillPendingFirstPublicRelease(\n  skill: Pick<\n    Doc<\"skills\">,\n    \"installKind\" | \"stats\" | \"moderationStatus\" | \"moderationReason\" | \"moderationFlags\"\n  >,\n) {\n  return isHostedSkillPendingPublicReview(skill) && (skill.stats?.versions ?? 0) <= 1;\n}\n\n/** Cheap hint that a hosted skill may have an older public version to resolve. */\nexport function hostedSkillMayHavePriorApprovedVersion(\n  skill: Pick<Doc<\"skills\">, \"installKind\" | \"stats\">,\n) {\n  return skill.installKind !== \"github\" && (skill.stats?.versions ?? 0) > 1;\n}\n\nexport function shouldExcludeSkillFromPublicBrowse(skill: SkillPublicBrowseFields) {\n  if (!isPublicSkillDoc(skill)) return true;\n  if (isSkillSuspicious(skill)) return true;\n  return isHostedSkillPendingFirstPublicRelease(skill);\n}\n\nexport function isPubliclyListableSkillVersion(\n  version: SkillVersionPublicBrowseFields | null | undefined,\n) {\n  if (!version || version.softDeletedAt) return false;\n  const statuses = [\n    normalizeSecurityScanStatus(version.vtAnalysis?.status),\n    normalizeSecurityScanStatus(version.llmAnalysis?.verdict ?? version.llmAnalysis?.status),\n    normalizeSecurityScanStatus(version.staticScan?.status),\n  ];\n  if (statuses.some((status) => status === \"pending\" || status === \"not-run\")) return false;\n  return !statuses.some((status) => isSecurityScanStatusBlockedFromPublic(status));\n}\n\nexport async function resolvePublicBrowseVersionState(\n  ctx: Pick<QueryCtx | MutationCtx, \"db\">,\n  skill: SkillPublicBrowseFields & { _id: Id<\"skills\"> },\n  options?: { latestVersion: Doc<\"skillVersions\"> | null },\n): Promise<PublicBrowseVersionState> {\n  if (shouldExcludeSkillFromPublicBrowse(skill)) return { status: \"unavailable\" };\n  const version = await resolvePublicBrowseVersionForSkill(ctx, skill, options);\n  return version ? { status: \"available\", versionId: version._id } : { status: \"unavailable\" };\n}\n\nexport async function resolvePublicBrowseVersionForSkill(\n  ctx: Pick<QueryCtx | MutationCtx, \"db\">,\n  skill: SkillPublicBrowseFields & { _id: Id<\"skills\"> },\n  options?: { latestVersion: Doc<\"skillVersions\"> | null },\n): Promise<Doc<\"skillVersions\"> | null> {\n  const latestVersionId = skill.latestVersionId;\n  if (!latestVersionId) return null;\n\n  if (!isSkillPendingPublicReview(skill)) {\n    const latestVersion = options ? options.latestVersion : await ctx.db.get(latestVersionId);\n    return latestVersion &&\n      latestVersion.skillId === skill._id &&\n      isPubliclyListableSkillVersion(latestVersion)\n      ? latestVersion\n      : null;\n  }\n\n  if (!hostedSkillMayHavePriorApprovedVersion(skill)) return null;\n\n  const versions = await ctx.db\n    .query(\"skillVersions\")\n    .withIndex(\"by_skill_active_created\", (q) =>\n      q.eq(\"skillId\", skill._id).eq(\"softDeletedAt\", undefined),\n    )\n    .order(\"desc\")\n    // A hosted skill can only have its latest version pending review. Read that\n    // version plus the immediately preceding public fallback, then fail closed.\n    .take(2);\n\n  for (const version of versions) {\n    if (version._id === skill.moderationSourceVersionId) continue;\n    if (isPubliclyListableSkillVersion(version)) return version;\n  }\n  return null;\n}";
const upstream = new Function(stripTypeScriptTypes(UPSTREAM_TS.replaceAll('export ', '')) +
  ';return {resolvePublicBrowseVersionState,isPubliclyListableSkillVersion};')();
function fixtureDb(versions) {
  const seen = {};
  return {seen, db: {
    get: async id => versions.find(v=>v._id===id)??null,
    query: table => {
      assert.equal(table,'skillVersions');
      const predicates=[];
      const chain={
        withIndex: (index, fn) => {
          assert.equal(index,'by_skill_active_created');
          const q={eq:(field,value)=>{predicates.push([field,value]);return q}};fn(q);return chain;
        },
        order: direction => {assert.equal(direction,'desc');return chain},
        take: async n => {seen.take=n;return versions.filter(v=>predicates.every(([k,value])=>v[k]===value)).sort((a,b)=>b.createdAt-a.createdAt).slice(0,n)},
      };return chain;
    },
  }};
}

test('pending scan keeps latest v2 but lists v1; card text remains the parent digest text', () => {
  const state=catalogState();
  assert.equal(state.skill.latestVersionId,'skillVersions:v2');
  assert.equal(state.versions[1].publicationStatus,'published');
  assert.equal(state.skill.moderationReason,'pending.scan');
  assert.deepEqual(state.digest.publicVersion,{status:'available',versionId:'skillVersions:v1'});
  assert.equal(state.entry.latestVersion.version,'1.0.0');
  assert.equal(state.entry.latestVersion.changelog,'v1：基础模板');
  assert.equal(state.entry.hydration,'public-version-read');
  assert.equal(state.entry.skill.displayName,state.skill.displayName);
  assert.equal(state.entry.skill.summary,state.skill.summary);
});

test('public v2 is selected only when its scan and parent moderation state are both synchronized', () => {
  const state=catalogState({v2Review:'public',v1Withdrawn:false,hidden:false});
  assert.equal(state.skill.moderationReason,'scanner.llm.clean');
  assert.deepEqual(state.digest.publicVersion,{status:'available',versionId:'skillVersions:v2'});
  assert.equal(state.entry.latestVersion.version,'2.0.0');
  assert.equal(state.entry.hydration,'digest-summary');
  const fixture=createCatalogFixture();
  fixture.versions[1].llmAnalysis={status:'clean',verdict:'benign'};
  assert.deepEqual(selectPublicVersion(fixture.skill,fixture.versions),{status:'available',versionId:'skillVersions:v1'});
});

test('no candidate and hidden Skill remain distinct causes; both preserve the materialized digest', () => {
  const noCandidate=catalogState({v2Review:'pending',v1Withdrawn:true,hidden:false});
  const hidden=catalogState({v2Review:'public',v1Withdrawn:false,hidden:true});
  assert.equal(noCandidate.outcome,'no-public-version');assert.equal(noCandidate.skill.moderationStatus,'active');
  assert.equal(hidden.outcome,'hidden');assert.equal(hidden.skill.moderationStatus,'hidden');
  for(const state of [noCandidate,hidden]){
    assert.equal(state.digest.skillId,'skills:field-notes');
    assert.equal(state.digest.latestVersionId,'skillVersions:v2');
    assert.deepEqual(state.digest.publicVersion,{status:'unavailable'});
    assert.equal(state.entry,null);
  }
});

test('projection selects shared card fields and owner enrichment without copying source-only fields', () => {
  const {skill,versions}=createCatalogFixture();const digest=projectSkillDigest(skill,versions);
  assert.equal('_id' in digest,false);assert.equal('moderationSourceVersionId' in digest,false);
  assert.equal('llmAnalysis' in digest,false);assert.equal(digest.ownerDisplayName,'Field Guide');
  assert.equal(digest.displayName,skill.displayName);assert.notEqual(digest.moderationFlags,skill.moderationFlags);
  assert.equal(hydratePublicEntry({...digest,publicVersion:{status:'available',versionId:'skillVersions:v1'}},versions.filter(v=>v._id!=='skillVersions:v1')),null);
});

test('all eight visible condition combinations match the executable fixed upstream resolver', async () => {
  for(const v2Review of ['pending','public'])for(const v1Withdrawn of [false,true])for(const hidden of [false,true]){
    const conditions={v2Review,v1Withdrawn,hidden};const {skill,versions}=createCatalogFixture(conditions);
    const ctx=fixtureDb(versions);
    assert.deepEqual(selectPublicVersion(skill,versions),await upstream.resolvePublicBrowseVersionState(ctx,skill),JSON.stringify(conditions));
    if(!hidden&&v2Review==='pending')assert.equal(ctx.seen.take,2);
  }
});

test('pending fallback fails closed after two active candidates and excludes a first release or GitHub branch', async () => {
  const {skill,versions}=createCatalogFixture();
  const pendingOld={...versions[0],llmAnalysis:{status:'pending'}};
  const third={...versions[0],_id:'skillVersions:older',createdAt:50};
  const rows=[versions[1],pendingOld,third];const ctx=fixtureDb(rows);
  assert.deepEqual(selectPublicVersion(skill,rows),{status:'unavailable'});
  assert.deepEqual(await upstream.resolvePublicBrowseVersionState(ctx,skill),{status:'unavailable'});
  assert.equal(ctx.seen.take,2);
  for(const next of [{...skill,stats:{versions:1}},{...skill,installKind:'github'}]){
    assert.deepEqual(selectPublicVersion(next,versions),{status:'unavailable'});
  }
});

test('version listability matches the source predicate, including nonblocked suspicious and unknown statuses', () => {
  const {versions}=createCatalogFixture();
  for(const status of ['clean','benign','suspicious','pending','not-run','failed','malicious','UNKNOWN',undefined]){
    const row={...versions[0],llmAnalysis:{status}};
    assert.equal(isListableVersion(row),upstream.isPubliclyListableSkillVersion(row),String(status));
  }
  assert.equal(normalizeScanStatus(' benign '),'clean');
  assert.equal(normalizeScanStatus('UNKNOWN'),undefined);
  assert.equal(isListableVersion({...versions[0],softDeletedAt:300}),false);
});
