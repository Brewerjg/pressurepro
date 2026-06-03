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

async function runMigration() {
  try {
    console.log('Checking profiles table...');

    // Check if any profiles exist
    const { data: profiles, error: fetchError } = await supabase
      .from('profiles')
      .select('id')
      .limit(10);

    if (fetchError) {
      console.error('Error fetching profiles:', fetchError);
      return;
    }

    console.log(`Found ${profiles?.length || 0} profiles`);

    // Try to update all profiles to ensure is_demo is false
    if (profiles && profiles.length > 0) {
      console.log('Attempting to update is_demo field...');

      const { error: updateError } = await supabase
        .from('profiles')
        .update({ is_demo: false })
        .not('id', 'is', null);

      if (updateError) {
        console.log('\n⚠️  Could not update is_demo field.');
        console.log('This likely means the column does not exist yet.');
        console.log('\nTo fix this, run the following SQL in your Supabase dashboard:');
        console.log('https://supabase.com/dashboard/project/dkksryutecjbyuscpxdb/sql\n');
        console.log('ALTER TABLE public.profiles');
        console.log('  ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false;');
        console.log('\nThen run this script again.');
      } else {
        console.log('✅ Successfully updated all profiles to set is_demo = false');

        // Verify the update
        const { data: verifyData } = await supabase
          .from('profiles')
          .select('id, is_demo')
          .limit(5);

        if (verifyData) {
          console.log('\nSample profiles after update:');
          verifyData.forEach(p => console.log(`  - ${p.id}: is_demo = ${p.is_demo}`));
        }
      }
    }

  } catch (error) {
    console.error('Migration error:', error);
  }
}

runMigration();