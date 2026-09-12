export type ConsultationMembership = {
  configured: boolean;
  isPro: boolean;
} | null;

export type ConsultationMembershipAction = 'none' | 'upgrade' | 'start' | 'disabled-start';

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
  if (membership.configured && membership.isPro) return '等待博主回复。';
  return '私人咨询仅 Pro 会员可用。已有记录始终可查看。';
}

export function consultationMembershipAction(
  role: {ready: boolean} | undefined,
  membership: ConsultationMembership,
  pending: boolean,
  error: string,
): ConsultationMembershipAction {
  if (role === undefined || pending || (!membership && !error)) return 'none';
  if (!role.ready) return 'none';
  if (error) return 'disabled-start';
  if (!membership) return 'none';
  if (membership.configured && membership.isPro) return 'start';
  return 'upgrade';
}
