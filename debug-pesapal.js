require('dotenv').config();

// Function to make HTTP requests (using Node.js built-in https module)
const https = require('https');

function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    
    const requestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'Brandify-Backend/1.0',
        ...options.headers
      }
    };

    const req = https.request(requestOptions, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          text: data
        });
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    if (options.body) {
      req.write(options.body);
    }
    
    req.end();
  });
}

async function testPesaPalCredentials() {
  console.log('=== PESAPAL CREDENTIALS DEBUG TEST ===\n');
  
  // Environment check
  const consumerKey = process.env.PESAPAL_CONSUMER_KEY;
  const consumerSecret = process.env.PESAPAL_CONSUMER_SECRET;
  const environment = process.env.PESAPAL_ENV || 'sandbox';
  
  console.log('Environment Variables:');
  console.log(`- PESAPAL_CONSUMER_KEY: ${consumerKey ? 'SET' : 'MISSING'}`);
  console.log(`- PESAPAL_CONSUMER_SECRET: ${consumerSecret ? 'SET' : 'MISSING'}`);
  console.log(`- PESAPAL_ENV: ${environment}`);
  
  if (!consumerKey || !consumerSecret) {
    console.error('❌ Missing required PesaPal credentials');
    return;
  }
  
  console.log(`\nCredential Details:`);
  console.log(`- Consumer Key Length: ${consumerKey.length}`);
  console.log(`- Consumer Secret Length: ${consumerSecret.length}`);
  console.log(`- Consumer Key Preview: ${consumerKey.substring(0, 10)}...`);
  console.log(`- Consumer Secret Preview: ${consumerSecret.substring(0, 10)}...`);
  
  // Check for common issues
  const issues = [];
  if (consumerKey.includes(' ')) issues.push('Consumer Key contains spaces');
  if (consumerSecret.includes(' ')) issues.push('Consumer Secret contains spaces');
  if (consumerKey.length < 20) issues.push('Consumer Key seems too short');
  if (consumerSecret.length < 20) issues.push('Consumer Secret seems too short');
  
  if (issues.length > 0) {
    console.log('\n⚠️  Potential Issues:');
    issues.forEach(issue => console.log(`   - ${issue}`));
  }
  
  const baseUrl = environment === 'production' 
    ? 'https://pay.pesapal.com/v3' 
    : 'https://cybqa.pesapal.com/pesapalv3';
  
  console.log(`\nBase URL: ${baseUrl}`);
  
  // Test authentication
  console.log('\n=== TESTING AUTHENTICATION ===');
  
  const authUrl = `${baseUrl}/api/Auth/RequestToken`;
  console.log(`Making request to: ${authUrl}`);
  
  const requestBody = {
    consumer_key: consumerKey.trim(),
    consumer_secret: consumerSecret.trim()
  };
  
  console.log('Request body keys:', Object.keys(requestBody));
  
  try {
    const response = await makeRequest(authUrl, {
      method: 'POST',
      body: JSON.stringify(requestBody)
    });
    
    console.log(`Response Status: ${response.status}`);
    console.log(`Raw Response: ${response.text}`);
    
    let responseData;
    try {
      responseData = JSON.parse(response.text);
      console.log('Parsed Response:', JSON.stringify(responseData, null, 2));
    } catch (parseError) {
      console.error('Failed to parse response as JSON:', parseError.message);
      return;
    }
    
    if (responseData.token) {
      console.log('\n✅ SUCCESS! Token received');
      console.log(`Token preview: ${responseData.token.substring(0, 50)}...`);
      
      // Test a simple API call with the token
      console.log('\n=== TESTING TOKEN USAGE ===');
      const testResponse = await makeRequest(`${baseUrl}/api/URLSetup/GetIpnList`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${responseData.token}`
        }
      });
      
      console.log(`Token test status: ${testResponse.status}`);
      if (testResponse.status === 200) {
        console.log('✅ Token is working correctly!');
      } else {
        console.log('⚠️  Token received but may have issues');
      }
      
    } else if (responseData.error) {
      console.log('\n❌ AUTHENTICATION FAILED');
      console.log('Error details:', responseData.error);
      
      if (responseData.error.code === 'invalid_consumer_key_or_secret_provided') {
        console.log('\n🔧 TROUBLESHOOTING STEPS:');
        console.log('1. Double-check your PesaPal developer dashboard credentials');
        console.log('2. Ensure you\'re using the correct environment (sandbox/production)');
        console.log('3. Verify no extra spaces or characters in credentials');
        console.log('4. Try regenerating your credentials in PesaPal dashboard');
        console.log('5. Contact PesaPal support if credentials appear correct');
        console.log('\n📋 NEXT STEPS:');
        console.log('• Login to https://developer.pesapal.com');
        console.log('• Go to your app settings');
        console.log('• Verify/regenerate Consumer Key and Consumer Secret');
        console.log('• Make sure you\'re in the correct environment (sandbox for testing)');
      }
    } else {
      console.log('\n❓ UNEXPECTED RESPONSE');
      console.log('Response does not contain token or error field');
    }
    
  } catch (error) {
    console.error('\n❌ REQUEST FAILED');
    console.error('Error:', error.message);
    
    if (error.code === 'ENOTFOUND') {
      console.log('\n🌐 Network connectivity issue detected');
      console.log('- Check your internet connection');
      console.log('- Try again in a few minutes');
    } else if (error.code === 'ECONNRESET') {
      console.log('\n🔄 Connection was reset');
      console.log('- This might be a temporary server issue');
      console.log('- Try again in a few minutes');
    }
  }
}

// Also test environment variable loading
console.log('=== ENVIRONMENT VARIABLES CHECK ===');
console.log('All environment variables:');
Object.keys(process.env)
  .filter(key => key.startsWith('PESAPAL_'))
  .forEach(key => {
    const value = process.env[key];
    console.log(`${key}: ${value ? (value.length > 20 ? value.substring(0, 20) + '...' : value) : 'NOT SET'}`);
  });

console.log('\n');
testPesaPalCredentials().catch(console.error);