const https = require('https');

const geminiKey = 'YOUR_GEMINI_KEY_HERE';
const groqKey = 'YOUR_GROQ_KEY_HERE';

function checkGemini() {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}`;
  https.get(url, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        if (json.models) {
          console.log('\n=== GEMINI MODELS ===');
          json.models.forEach(m => {
             if (m.name.includes('flash') || m.name.includes('pro')) {
                 console.log(m.name);
             }
          });
        } else {
          console.log('\nGemini Error:', json);
        }
      } catch(e) {
        console.log('Gemini Parse Error:', e.message);
      }
    });
  }).on('error', err => console.log('Gemini Request Error:', err.message));
}

function checkGroq() {
  const options = {
    hostname: 'api.groq.com',
    path: '/openai/v1/models',
    method: 'GET',
    headers: { 'Authorization': `Bearer ${groqKey}` }
  };
  const req = https.request(options, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        if (json.data) {
          console.log('\n=== GROQ MODELS ===');
          json.data.forEach(m => console.log(m.id));
        } else {
          console.log('\nGroq Error:', json);
        }
      } catch(e) {
        console.log('Groq Parse Error:', e.message);
      }
    });
  });
  req.on('error', err => console.log('Groq Request Error:', err.message));
  req.end();
}

checkGemini();
checkGroq();
