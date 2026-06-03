import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

// Read .env file manually
const envContent = readFileSync('.env', 'utf-8');
const envVars = {};
envContent.split('\n').forEach(line => {
  if (line && !line.startsWith('#')) {
    const [key, value] = line.split('=');
    if (key && value) {
      envVars[key.trim()] = value.trim();
    }
  }
});

const supabaseUrl = envVars.VITE_SUPABASE_URL;
const supabaseKey = envVars.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function cleanTurfProData() {
  try {
    console.log('🧹 Starting TurfPro data cleanup...\n');

    // Check if user is signed in
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      console.log('❌ Not signed in. Please sign in through the app first:');
      console.log('1. Go to http://localhost:8081/auth');
      console.log('2. Sign in with your account');
      console.log('3. Then run this script again');
      return;
    }

    console.log(`✅ Signed in as: ${user.email}\n`);

    // Clean TurfPro-specific tables
    console.log('📦 Cleaning TurfPro-specific tables...');

    const tablesToClean = [
      'route_stops',
      'routes',
      'chemical_applications',
      'chemical_inventory',
      'photo_pairs_lawn',
      'campaigns',
      'sms_messages',
      'sms_conversations',
      'sms_templates'
    ];

    for (const table of tablesToClean) {
      const { error } = await supabase
        .from(table)
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all (using impossible UUID)

      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows to delete
        console.log(`  ⚠️  Could not clean ${table}: ${error.message}`);
      } else {
        console.log(`  ✅ Cleaned ${table}`);
      }
    }

    // Clean lawn-specific catalog items
    console.log('\n📝 Cleaning lawn-specific catalog items...');
    const lawnCatalogItems = [
      'Weekly mow', 'Biweekly mow', 'Edge', 'Trim', 'Blow',
      'Spring cleanup', 'Fall cleanup', 'Leaf removal',
      'Aeration', 'Overseed', 'Dethatching', 'Mulch install',
      'Fert step 1 (pre-emergent)', 'Fert step 2 (weed + feed)',
      'Fert step 3 (summer feed)', 'Fert step 4 (fall feed)',
      'Fert step 5 (winterize)', 'Weed control (spot)',
      'Grub control', 'Lime application',
      'Snow plow (per visit)', 'Snow shovel (per visit)'
    ];

    const { error: catalogError } = await supabase
      .from('catalog_items')
      .delete()
      .in('name', lawnCatalogItems);

    if (catalogError && catalogError.code !== 'PGRST116') {
      console.log(`  ⚠️  Could not clean catalog items: ${catalogError.message}`);
    } else {
      console.log(`  ✅ Cleaned lawn catalog items`);
    }

    // Reset user's profile for fresh TurfPro onboarding
    console.log('\n👤 Resetting your profile for TurfPro onboarding...');
    const { error: profileError } = await supabase
      .from('profiles')
      .update({
        onboarded_at: null,
        is_demo: false
      })
      .eq('user_id', user.id);

    if (profileError) {
      console.log(`  ⚠️  Could not reset profile: ${profileError.message}`);
    } else {
      console.log(`  ✅ Reset profile onboarding status`);
    }

    // Clean TurfPro crews
    console.log('\n👥 Cleaning TurfPro crews...');
    const turfColors = ['#1f7a44', '#b08236', '#3b6fb0', '#a23c5b', '#5b6b3a', '#7a4b1f', '#3a6b6b', '#6b3a6b'];
    const { error: crewError } = await supabase
      .from('crews')
      .delete()
      .in('color', turfColors);

    if (crewError && crewError.code !== 'PGRST116') {
      console.log(`  ⚠️  Could not clean crews: ${crewError.message}`);
    } else {
      console.log(`  ✅ Cleaned TurfPro crews`);
    }

    console.log('\n🎉 TurfPro data cleanup complete!');
    console.log('\nNext steps:');
    console.log('1. Go to http://localhost:8081');
    console.log('2. You should be redirected to /onboarding');
    console.log('3. Complete the TurfPro setup wizard with a fresh start');

  } catch (error) {
    console.error('❌ Error during cleanup:', error);
  }
}

cleanTurfProData();