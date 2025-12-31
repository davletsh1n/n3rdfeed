import { config } from 'dotenv';
import { updateContent } from '../src/scheduled.js';

config();

async function main() {
  try {
    console.log('Starting content update...');
    await updateContent();
    console.log('Content updated successfully');
    process.exit(0);
  } catch (error) {
    console.error('Error updating content:', error);
    process.exit(1);
  }
}

main();
