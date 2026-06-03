import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runMigration() {
  try {
    console.log('Adding is_demo column to profiles table...');

    // Note: We can't run ALTER TABLE through the client API
    // But we can check and update existing records

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

    // Update all profiles to ensure is_demo is false
    if (profiles && profiles.length > 0) {
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ is_demo: false })
        .not('id', 'is', null);

      if (updateError) {
        // If the column doesn't exist, we'll get an error
        console.error('Note: is_demo column might not exist yet. Run the migration SQL in Supabase dashboard.');
        console.error('Error details:', updateError);
      } else {
        console.log('Successfully updated all profiles to set is_demo = false');
      }
    }

    // Verify the update
    const { data: verifyData, error: verifyError } = await supabase
      .from('profiles')
      .select('id, is_demo')
      .limit(5);

    if (verifyData) {
      console.log('Sample profiles after update:', verifyData);
    }

  } catch (error) {
    console.error('Migration error:', error);
  }
}

runMigration();