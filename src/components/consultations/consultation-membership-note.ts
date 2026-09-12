export type ConsultationMembership = {
  configured: boolean;
  isPro: boolean;
} | null;

export function consultationMembershipNote(
  role: {ready: boolean} | undefined,
  membership: ConsultationMembership,
  pending: boolean,
  error: string,
) {
  if (role === undefined) return '正在加载咨询…';
  if (!role.ready) return '私人咨询尚未开放。';
  if (pending) return '正在核验会员状态…';
  if (!membership) return error ? '' : '正在核验会员状态…';
  if (error) return '';
  if (!membership.configured) return '私人咨询尚未开放。';
  if (membership.isPro) return '等待博主回复。';
  return '私人咨询仅 Pro 会员可用。已有记录始终可查看。';
}
