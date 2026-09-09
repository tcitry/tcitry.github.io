export * from './reader-clerk';

// Payment UI is deliberately a local placeholder: this test cannot checkout.
export function PricingTable({for: payer}: {for?: string}) {
  return <div data-fixture-pricing data-payer={payer}>Clerk 订阅方案（本地测试）</div>;
}
