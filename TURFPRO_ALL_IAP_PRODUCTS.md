# TurfPro Complete In-App Purchase Configuration

## All 6 Products for App Store Connect

Create these exact auto-renewable subscriptions in your TurfPro Plans subscription group:

### Base Tier Products
| Product ID | Price | Duration | Reference Name | Description |
|------------|-------|----------|----------------|-------------|
| `turfpro_payg_monthly` | $5.00 | 1 Month | TurfPro Base Monthly | Low base fee with pay-as-you-earn model. All operator features included. 1.5% fee on processed payments. |
| `turfpro_payg_yearly` | $50.00 | 1 Year | TurfPro Base Yearly | Save $10/year. Low base fee with pay-as-you-earn model. All operator features included. 1.5% fee on processed payments. |

### Solo Tier Products
| Product ID | Price | Duration | Reference Name | Description |
|------------|-------|----------|----------------|-------------|
| `turfpro_solo_monthly` | $15.00 | 1 Month | TurfPro Solo Monthly | One truck, one operator. Up to 50 stops/week, customer records, photos, chemical log, weather planner. No transaction fees. |
| `turfpro_solo_yearly` | $150.00 | 1 Year | TurfPro Solo Yearly | Save $30/year. One truck, one operator. Up to 50 stops/week. No transaction fees. |

### Crew Tier Products
| Product ID | Price | Duration | Reference Name | Description |
|------------|-------|----------|----------------|-------------|
| `turfpro_crew_monthly` | $49.00 | 1 Month | TurfPro Crew Monthly | Multi-truck operation. 5 user seats, unlimited stops, route optimization, fleet view, reports. No transaction fees. |
| `turfpro_crew_yearly` | $490.00 | 1 Year | TurfPro Crew Yearly | Save $98/year. Multi-truck operation. 5 user seats, unlimited stops. No transaction fees. |

## Step-by-Step App Store Connect Setup

### 1. Create Subscription Group
1. Sign in to [App Store Connect](https://appstoreconnect.apple.com)
2. Select your app
3. Go to **Monetization** → **Subscriptions**
4. Click **+** to create subscription group
5. Name: `TurfPro Plans`

### 2. Add Each Product
For each of the 6 products above:

1. Click **+** in the TurfPro Plans group
2. Enter the **Product ID** exactly as shown
3. Set **Reference Name** as shown
4. Select **Duration** (1 Month or 1 Year)
5. Add **Localization**:
   - Display Name: Use the Reference Name
   - Description: Use the description from table
6. Set **Pricing**:
   - Select the price tier that matches the price shown
   - Enable all countries
7. **Save** and mark as **Ready to Submit**

### 3. Set Subscription Order (Important!)
In the subscription group, arrange the upgrade/downgrade hierarchy:
1. Crew (highest tier)
2. Solo (middle tier)
3. Base (lowest tier)

This ensures proper upgrade/downgrade behavior.

## RevenueCat Configuration

### Products to Import
RevenueCat should auto-import all 6 products:
- `turfpro_payg_monthly`
- `turfpro_payg_yearly`
- `turfpro_solo_monthly`
- `turfpro_solo_yearly`
- `turfpro_crew_monthly`
- `turfpro_crew_yearly`

### Entitlement Setup
Create ONE entitlement:
- **Identifier**: `pro`
- **Display Name**: Pro Features
- **Attach ALL 6 products** to this entitlement

### Offering Configuration
Create the default offering with these packages:

| Package ID | Product | Display Name |
|------------|---------|--------------|
| `base_monthly` | turfpro_payg_monthly | Base - $5/month |
| `base_yearly` | turfpro_payg_yearly | Base - $50/year |
| `solo_monthly` | turfpro_solo_monthly | Solo - $15/month |
| `solo_yearly` | turfpro_solo_yearly | Solo - $150/year |
| `crew_monthly` | turfpro_crew_monthly | Crew - $49/month |
| `crew_yearly` | turfpro_crew_yearly | Crew - $490/year |

## Implementation Notes

### How the Fees Work
- **Base Tier**: $5/mo subscription PLUS 1.5% on each customer payment (handled by Stripe Connect, not Apple)
- **Solo/Crew Tiers**: Fixed monthly price, 0% transaction fees on customer payments

### Code Update Required
The app already maps these product IDs in `/src/lib/stripe.ts`:
```javascript
const PRICE_TO_TIER: Record<string, TierId> = {
  turfpro_payg_monthly: "payg",  // Base tier
  turfpro_payg_yearly: "payg",   // Base tier
  turfpro_solo_monthly: "solo",
  turfpro_solo_yearly: "solo",
  turfpro_crew_monthly: "crew",
  turfpro_crew_yearly: "crew",
};
```

The RevenueCat integration will use these same IDs.

## Testing Checklist
- [ ] All 6 products created in App Store Connect
- [ ] Products show "Ready to Submit" status
- [ ] RevenueCat imported all 6 products
- [ ] Entitlement has all products attached
- [ ] Offering has all 6 packages configured
- [ ] Test purchases for each tier in sandbox
- [ ] Verify subscription status syncs correctly
- [ ] Test upgrade/downgrade between tiers
- [ ] Confirm 1.5% fee applies only to Base tier customer payments

## Important Pricing Notes
1. **Base**: $5/mo or $50/yr + 1.5% on payments processed
2. **Solo**: $15/mo or $150/yr + 0% on payments
3. **Crew**: $49/mo or $490/yr + 0% on payments

The 1.5% fee for Base tier is handled separately when processing customer payments through Stripe Connect - it's NOT part of the IAP subscription.