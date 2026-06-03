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

async function checkDatabase() {
  try {
    console.log('🔍 Checking database structure...\n');

    // 1. Check if we're authenticated
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      console.log(`✅ Authenticated as: ${user.email}`);
      console.log(`   User ID: ${user.id}\n`);
    } else {
      console.log('❌ Not authenticated. Please sign in first.\n');
    }

    // 2. Try to query profiles table
    console.log('📊 Checking profiles table...');

    // Try with id column
    console.log('   Trying with id column...');
    const { data: profile1, error: error1 } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user?.id || 'test')
      .maybeSingle();

    if (profile1) {
      console.log('   ✅ Found profile with id column:');
      console.log('   ', JSON.stringify(profile1, null, 2));
    } else if (error1) {
      console.log('   ❌ Error with id column:', error1.message);
    } else {
      console.log('   ⚠️  No profile found with id column');
    }

    // Try with user_id column
    console.log('\n   Trying with user_id column...');
    const { data: profile2, error: error2 } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', user?.id || 'test')
      .maybeSingle();

    if (profile2) {
      console.log('   ✅ Found profile with user_id column:');
      console.log('   ', JSON.stringify(profile2, null, 2));
    } else if (error2) {
      console.log('   ❌ Error with user_id column:', error2.message);
    } else {
      console.log('   ⚠️  No profile found with user_id column');
    }

    // 3. Try to get all profiles (limited to 5)
    console.log('\n📋 Fetching sample profiles (max 5)...');
    const { data: allProfiles, error: allError } = await supabase
      .from('profiles')
      .select('*')
      .limit(5);

    if (allProfiles && allProfiles.length > 0) {
      console.log(`   Found ${allProfiles.length} profile(s):`);
      allProfiles.forEach((p, i) => {
        console.log(`\n   Profile ${i + 1}:`);
        Object.keys(p).forEach(key => {
          const value = p[key];
          const displayValue = value === null ? 'NULL' :
                              value === '' ? '(empty string)' :
                              typeof value === 'object' ? JSON.stringify(value) : value;
          console.log(`      ${key}: ${displayValue}`);
        });
      });
    } else if (allError) {
      console.log('   ❌ Error fetching profiles:', allError.message);
    } else {
      console.log('   ⚠️  No profiles found in table');
    }

    // 4. Try to insert/update a test profile
    if (user) {
      console.log('\n🔧 Testing profile operations...');

      // Try update with id
      console.log('   Testing update with id column...');
      const { data: updateData1, error: updateError1 } = await supabase
        .from('profiles')
        .update({
          updated_at: new Date().toISOString(),
          test_field: 'test_from_cli'
        })
        .eq('id', user.id)
        .select();

      if (updateData1) {
        console.log('   ✅ Successfully updated with id column');
      } else if (updateError1) {
        console.log('   ❌ Update with id failed:', updateError1.message);
      }

      // Try update with user_id
      console.log('   Testing update with user_id column...');
      const { data: updateData2, error: updateError2 } = await supabase
        .from('profiles')
        .update({
          updated_at: new Date().toISOString(),
          test_field: 'test_from_cli'
        })
        .eq('user_id', user.id)
        .select();

      if (updateData2) {
        console.log('   ✅ Successfully updated with user_id column');
      } else if (updateError2) {
        console.log('   ❌ Update with user_id failed:', updateError2.message);
      }
    }

    // 5. Check RLS policies
    console.log('\n🔒 Checking Row Level Security...');
    const { data: testInsert, error: insertError } = await supabase
      .from('profiles')
      .insert({
        id: 'test-' + Date.now(),
        created_at: new Date().toISOString()
      })
      .select();

    if (insertError) {
      if (insertError.message.includes('violates row-level security')) {
        console.log('   ✅ RLS is enabled (good for security)');
        console.log('   ℹ️  Make sure RLS policies allow users to manage their own profiles');
      } else {
        console.log('   ❌ Insert test failed:', insertError.message);
      }
    } else {
      console.log('   ⚠️  Test insert succeeded - check if RLS is properly configured');
      // Clean up test record if it was created
      if (testInsert && testInsert[0]) {
        await supabase.from('profiles').delete().eq('id', testInsert[0].id);
      }
    }

  } catch (error) {
    console.error('❌ Unexpected error:', error);
  }
}

checkDatabase();