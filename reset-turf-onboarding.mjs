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

async function resetTurfOnboarding() {
  try {
    // First, sign in with your existing credentials
    console.log('Please sign in with your PressurePro credentials...');
    console.log('Enter your email:');

    // For now, you'll need to manually sign in through the app
    // Let's check if you're already signed in
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      console.log('\n❌ Not signed in. Please sign in through the app first.');
      console.log('1. Go to http://localhost:8081/auth');
      console.log('2. Sign in with your PressurePro account');
      console.log('3. Then run this script again');
      return;
    }

    console.log(`\n✅ Signed in as: ${user.email}`);
    console.log(`User ID: ${user.id}`);

    // Check current profile status
    const { data: profile, error: fetchError } = await supabase
      .from('profiles')
      .select('onboarded_at, is_demo')
      .eq('user_id', user.id)
      .maybeSingle();

    if (fetchError) {
      console.error('Error fetching profile:', fetchError);
      return;
    }

    if (!profile) {
      console.log('\n📝 No profile found. A new one will be created during onboarding.');
    } else {
      console.log('\n📝 Current profile status:');
      console.log(`  - onboarded_at: ${profile.onboarded_at || 'null'}`);
      console.log(`  - is_demo: ${profile.is_demo || 'false'}`);

      // Reset onboarded_at to null to trigger TurfPro onboarding
      console.log('\n🔄 Resetting TurfPro onboarding status...');

      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          onboarded_at: null,
          is_demo: false  // Ensure you're not marked as demo
        })
        .eq('user_id', user.id);

      if (updateError) {
        console.error('Error updating profile:', updateError);
      } else {
        console.log('✅ Successfully reset onboarding status!');
        console.log('\n🎉 Next steps:');
        console.log('1. Go to http://localhost:8081');
        console.log('2. You should be redirected to /onboarding');
        console.log('3. Complete the TurfPro setup wizard');
        console.log('\nYou can now use the same login for both PressurePro and TurfPro!');
      }
    }

  } catch (error) {
    console.error('Error:', error);
  }
}

resetTurfOnboarding();