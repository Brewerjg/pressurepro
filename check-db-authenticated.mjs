import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import readline from 'readline';

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

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise(resolve => {
    rl.question(prompt, resolve);
  });
}

async function checkDatabaseAuthenticated() {
  try {
    // Get credentials
    const email = await question('Enter your email: ');
    const password = await question('Enter your password: ');

    // Sign in
    console.log('\n🔐 Signing in...');
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (authError) {
      console.error('❌ Sign in failed:', authError.message);
      rl.close();
      return;
    }

    const user = authData.user;
    console.log(`✅ Signed in as: ${user.email}`);
    console.log(`   User ID: ${user.id}\n`);

    // Now check the database structure
    console.log('📊 Checking profiles table structure...\n');

    // Try to get profile with id column
    console.log('Testing with id column:');
    const { data: profileById, error: errorById } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    if (profileById) {
      console.log('✅ Found profile using id column:');
      console.log(JSON.stringify(profileById, null, 2));
    } else if (errorById) {
      console.log('❌ Error with id column:', errorById.message);
    } else {
      console.log('⚠️  No profile found with id column');
    }

    // Try to get profile with user_id column
    console.log('\nTesting with user_id column:');
    const { data: profileByUserId, error: errorByUserId } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (profileByUserId) {
      console.log('✅ Found profile using user_id column:');
      console.log(JSON.stringify(profileByUserId, null, 2));
    } else if (errorByUserId) {
      console.log('❌ Error with user_id column:', errorByUserId.message);
    } else {
      console.log('⚠️  No profile found with user_id column');
    }

    // Test update operations
    console.log('\n🔧 Testing update operations...\n');

    // Test data for update
    const testData = {
      business_name: 'Test Business',
      phone: '555-1234',
      zip: '12345',
      onboarded_at: null,
      is_demo: false
    };

    // Try update with id
    console.log('Testing update with id column:');
    const { data: updateById, error: updateErrorById } = await supabase
      .from('profiles')
      .update(testData)
      .eq('id', user.id)
      .select();

    if (updateById && updateById.length > 0) {
      console.log('✅ Update with id column succeeded');
      console.log('Updated data:', JSON.stringify(updateById[0], null, 2));
    } else if (!updateErrorById) {
      console.log('⚠️  No rows updated with id column (profile may not exist)');
    } else {
      console.log('❌ Update with id column failed:', updateErrorById.message);
    }

    // Try update with user_id
    console.log('\nTesting update with user_id column:');
    const { data: updateByUserId, error: updateErrorByUserId } = await supabase
      .from('profiles')
      .update(testData)
      .eq('user_id', user.id)
      .select();

    if (updateByUserId && updateByUserId.length > 0) {
      console.log('✅ Update with user_id column succeeded');
      console.log('Updated data:', JSON.stringify(updateByUserId[0], null, 2));
    } else if (!updateErrorByUserId) {
      console.log('⚠️  No rows updated with user_id column (profile may not exist)');
    } else {
      console.log('❌ Update with user_id column failed:', updateErrorByUserId.message);
    }

    // Try insert if no updates worked
    if (!updateById?.length && !updateByUserId?.length) {
      console.log('\n📝 No profile exists, attempting to create one...\n');

      // Try insert with id
      console.log('Testing insert with id column:');
      const { data: insertById, error: insertErrorById } = await supabase
        .from('profiles')
        .insert({
          id: user.id,
          ...testData
        })
        .select();

      if (insertById) {
        console.log('✅ Insert with id column succeeded');
        console.log('Inserted data:', JSON.stringify(insertById[0], null, 2));
      } else if (insertErrorById) {
        console.log('❌ Insert with id column failed:', insertErrorById.message);

        // Try with user_id
        console.log('\nTesting insert with user_id column:');
        const { data: insertByUserId, error: insertErrorByUserId } = await supabase
          .from('profiles')
          .insert({
            user_id: user.id,
            ...testData
          })
          .select();

        if (insertByUserId) {
          console.log('✅ Insert with user_id column succeeded');
          console.log('Inserted data:', JSON.stringify(insertByUserId[0], null, 2));
        } else if (insertErrorByUserId) {
          console.log('❌ Insert with user_id column failed:', insertErrorByUserId.message);
        }
      }
    }

    console.log('\n✅ Database check complete!');

  } catch (error) {
    console.error('❌ Unexpected error:', error);
  } finally {
    rl.close();
  }
}

checkDatabaseAuthenticated();