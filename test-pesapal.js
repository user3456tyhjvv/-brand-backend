// Save this as test-pesapal.js and run with: node test-pesapal.js
// This will test your PesaPal credentials independently

require('dotenv').config();

const PESAPAL_BASE_URL = process.env.PESAPAL_ENV === 'production' 
  ? 'https://pay.pesapal.com/v3' 
  : 'https://cybqa.pesapal.com/pesapalv3';

async function testPesaPalCredentials() {
  console.log('=== PESAPAL CREDENTIALS TEST ===');
  
  // Check environment variables
  console.log('Environment variables:');
  console.log('- PESAPAL_CONSUMER_KEY exists:', !!process.env.PESAPAL_CONSUMER_KEY);
  console.log('- PESAPAL_CONSUMER_SECRET exists:', !!process.env.PESAPAL_CONSUMER_SECRET);
  console.log('- PESAPAL_ENV:', process.env.PESAPAL_ENV || 'sandbox (default)');
  console.log('- Base URL:', PESAPAL_BASE_URL);
  
  if (!process.env.PESAPAL_CONSUMER_KEY || !process.env.PESAPAL_CONSUMER_SECRET) {
    console.error('❌ Missing PesaPal credentials in environment variables');
    return;
  }
  
  console.log('- Consumer Key length:', process.env.PESAPAL_CONSUMER_KEY.length);
  console.log('- Consumer Secret length:', process.env.PESAPAL_CONSUMER_SECRET.length);
  console.log('- Consumer Key starts with:', process.env.PESAPAL_CONSUMER_KEY.substring(0, 10) + '...');
  
  try {
    console.log('\n=== TESTING AUTH REQUEST ===');
    
    const requestBody = {
      consumer_key: process.env.PESAPAL_CONSUMER_KEY,
      consumer_secret: process.env.PESAPAL_CONSUMER_SECRET
    };
    
    console.log('Making request to:', `${PESAPAL_BASE_URL}/api/Auth/RequestToken`);
    
    const response = await fetch(`${PESAPAL_BASE_URL}/api/Auth/RequestToken`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });
    
    console.log('Response status:', response.status);
    console.log('Response headers:', Object.fromEntries(response.headers.entries()));
    
    const responseText = await response.text();
    console.log('Raw response:', responseText);
    
    if (response.ok) {
      try {
        const data = JSON.parse(responseText);
        console.log('✅ SUCCESS - Parsed response:', data);
        
        if (data.token) {
          console.log('✅ Token found:', data.token.substring(0, 20) + '...');
        } else {
          console.log('⚠️  Response successful but no token field found');
          console.log('Available fields:', Object.keys(data));
        }
      } catch (parseError) {
        console.log('⚠️  Response successful but not valid JSON:', parseError.message);
      }
    } else {
      console.log('❌ Auth request failed');
      try {
        const errorData = JSON.parse(responseText);
        console.log('Error details:', errorData);
      } catch {
        console.log('Error response (raw):', responseText);
      }
    }
    
  } catch (error) {
    console.error('❌ Request failed:', error.message);
    console.error('Full error:', error);
  }
}

// Test different request formats
async function testDifferentFormats() {
  console.log('\n=== TESTING DIFFERENT REQUEST FORMATS ===');
  
  const formats = [
    {
      name: 'Format 1: consumer_key/consumer_secret',
      body: {
        consumer_key: process.env.PESAPAL_CONSUMER_KEY,
        consumer_secret: process.env.PESAPAL_CONSUMER_SECRET
      }
    },
    {
      name: 'Format 2: consumerKey/consumerSecret',
      body: {
        consumerKey: process.env.PESAPAL_CONSUMER_KEY,
        consumerSecret: process.env.PESAPAL_CONSUMER_SECRET
      }
    },
    {
      name: 'Format 3: key/secret',
      body: {
        key: process.env.PESAPAL_CONSUMER_KEY,
        secret: process.env.PESAPAL_CONSUMER_SECRET
      }
    }
  ];
  
  for (const format of formats) {
    console.log(`\nTrying ${format.name}...`);
    
    try {
      const response = await fetch(`${PESAPAL_BASE_URL}/api/Auth/RequestToken`, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(format.body)
      });
      
      console.log(`${format.name} - Status:`, response.status);
      
      const responseText = await response.text();
      
      if (response.ok) {
        console.log(`✅ ${format.name} - SUCCESS`);
        try {
          const data = JSON.parse(responseText);
          console.log(`${format.name} - Response:`, data);
        } catch {
          console.log(`${format.name} - Raw response:`, responseText);
        }
        break; // Stop testing if one works
      } else {
        console.log(`❌ ${format.name} - Failed:`, responseText.substring(0, 200));
      }
      
    } catch (error) {
      console.log(`❌ ${format.name} - Error:`, error.message);
    }
  }
}

// Run tests
async function runAllTests() {
  await testPesaPalCredentials();
  await testDifferentFormats();
}

runAllTests().catch(console.error);