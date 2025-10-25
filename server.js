const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs'); // Import the file system module
const session = require('express-session');
const { RedisStore } = require("connect-redis");
const redis = require('redis');
require('dotenv').config();

// --- START: REDIS SETUP (for sessions) ---
const redisClient = redis.createClient({
    socket: {
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT
    },
    legacyMode: false
});

redisClient.on('error', (err) => console.error('Redis Client Error:', err));
redisClient.on('connect', () => console.log('Connected to Redis for session storage'));
// --- END: REDIS SETUP ---

// --- START: POSTGRESQL SETUP (for analytics) ---
const { Pool } = require('pg');

const pgPool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: process.env.POSTGRES_PORT,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    database: process.env.POSTGRES_DB,
    max: 20, // Maximum number of clients in the pool
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

let dbConnected = false;

// Initialize PostgreSQL connection and create tables
async function connectDB() {
    try {
        // Test connection
        const client = await pgPool.connect();
        console.log('Connected to PostgreSQL');
        
        // Create tables if they don't exist
        await client.query(`
            CREATE TABLE IF NOT EXISTS visits (
                id SERIAL PRIMARY KEY,
                user_id VARCHAR(255) NOT NULL,
                timestamp TIMESTAMPTZ DEFAULT NOW(),
                user_agent TEXT
            );

            CREATE TABLE IF NOT EXISTS color_stats (
                name VARCHAR(255) PRIMARY KEY,
                hex VARCHAR(255) NOT NULL,
                index INTEGER,
                count INTEGER DEFAULT 0,
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS combination_selections (
                id SERIAL PRIMARY KEY,
                combination_index INTEGER NOT NULL,
                colors JSONB NOT NULL,
                user_id VARCHAR(255) NOT NULL,
                timestamp TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS gender_stats (
                gender VARCHAR(50) PRIMARY KEY,
                count INTEGER DEFAULT 0,
                last_updated TIMESTAMPTZ DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS user_actions (
                user_id VARCHAR(255) PRIMARY KEY,
                entry_timestamp TIMESTAMPTZ,
                last_generate_timestamp TIMESTAMPTZ,
                generate_count INTEGER DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_visits_timestamp ON visits(timestamp);
            CREATE INDEX IF NOT EXISTS idx_combination_selections_user ON combination_selections(user_id);
            CREATE INDEX IF NOT EXISTS idx_combination_selections_timestamp ON combination_selections(timestamp);
        `);
        
        client.release();
        dbConnected = true;
        console.log('PostgreSQL tables initialized');
    } catch (err) {
        console.error('PostgreSQL connection error:', err);
        dbConnected = false;
    }
}

// Initialize connection
connectDB();

// --- END: POSTGRESQL SETUP ---

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// Timeout wrapper for fetch requests
async function fetchWithTimeout(url, options = {}, timeout = 30000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            throw new Error('API_TIMEOUT');
        }
        throw error;
    }
}

const app = express();
const PORT = process.env.PORT || 8080;

// Create a directory for generated images if it doesn't exist
const generatedDir = path.join(__dirname, 'generated');
if (!fs.existsSync(generatedDir)) {
    fs.mkdirSync(generatedDir);
}

// Cleanup function to delete entire session folder
function cleanupSessionImages(sessionId) {
    const sessionFolder = path.join(generatedDir, sessionId);
    
    if (fs.existsSync(sessionFolder)) {
        try {
            const files = fs.readdirSync(sessionFolder);
            console.log(`Cleaning up ${files.length} images for session ${sessionId}`);
            
            // Delete all files in the folder
            files.forEach(file => {
                const filePath = path.join(sessionFolder, file);
                fs.unlinkSync(filePath);
                console.log(`Deleted: ${file}`);
            });
            
            // Delete the folder itself
            fs.rmdirSync(sessionFolder);
            console.log(`Deleted session folder: ${sessionId}`);
        } catch (error) {
            console.error(`Error cleaning up session ${sessionId}:`, error);
        }
    }
}

// Helper function to get or create session folder
function getSessionFolder(sessionId) {
    const sessionFolder = path.join(generatedDir, sessionId);
    if (!fs.existsSync(sessionFolder)) {
        fs.mkdirSync(sessionFolder, { recursive: true });
        console.log(`Created session folder: ${sessionId}`);
    }
    return sessionFolder;
}

// Periodic cleanup of old session folders - checks both Redis and folder age
setInterval(async () => {
    try {
        const now = Date.now();
        const maxAge = 1000 * 10 * 60 * 24; // 2 hours (matches session cookie maxAge)
        
        const folders = fs.readdirSync(generatedDir);
        
        for (const folder of folders) {
            const folderPath = path.join(generatedDir, folder);
            
            // Only process directories (session folders)
            if (fs.statSync(folderPath).isDirectory()) {
                const sessionKey = `wada:sess:${folder}`;
                let shouldDelete = false;
                
                try {
                    // Check if session exists in Redis
                    const sessionExists = await redisClient.exists(sessionKey);
                    
                    if (!sessionExists) {
                        // Session expired in Redis, delete the folder
                        shouldDelete = true;
                        console.log(`Session expired in Redis: ${folder}`);
                    } else {
                        // Session still exists, but check folder age as backup
                        const stats = fs.statSync(folderPath);
                        const folderAge = now - stats.mtimeMs;
                        
                        if (folderAge > maxAge) {
                            shouldDelete = true;
                            console.log(`Session folder too old: ${folder}`);
                        }
                    }
                } catch (redisError) {
                    // If Redis check fails, fall back to age-based cleanup
                    console.warn(`Redis check failed for ${folder}, using age-based cleanup:`, redisError);
                    const stats = fs.statSync(folderPath);
                    const folderAge = now - stats.mtimeMs;
                    shouldDelete = folderAge > maxAge;
                }
                
                if (shouldDelete) {
                    // Delete all files in the folder
                    const files = fs.readdirSync(folderPath);
                    files.forEach(file => {
                        fs.unlinkSync(path.join(folderPath, file));
                    });
                    // Delete the folder
                    fs.rmdirSync(folderPath);
                    console.log(`Cleaned up session folder: ${folder}`);
                }
            }
        }
    } catch (error) {
        console.error('Error during periodic cleanup:', error);
    }
}, 1000 * 60 * 60 );  // Every 1 hour

// --- MIDDLEWARE ---
app.use(cors({
    origin: true,
    credentials: true
}));

// Trust Cloudflare/reverse proxy - CRITICAL for proper session handling behind Cloudflare
// This allows Express to read the correct client IP and protocol from proxy headers
// Without this, sessions will be recreated on every request when behind Cloudflare
app.set('trust proxy', 1);

// Session configuration with Redis store for high-performance persistence
app.use(session({
    secret: process.env.SESSION_SECRET || 'wada-sanzo-secret-key-change-in-production',
    resave: false,
    saveUninitialized: true,
    store: new RedisStore({
        client: redisClient,
        prefix: 'wada:sess:', // Prefix for session keys in Redis
        ttl: 60 * 60 * 2          // 2 hours
    }),
    cookie: { 
        maxAge: 1000 * 60 * 60 * 2,  // 2 hours (match Redis!)
        httpOnly: true,
        // 'auto' makes cookies work with Cloudflare - secure when HTTPS, non-secure when HTTP
        // Cloudflare uses HTTPS to client but may use HTTP to origin server
        secure: 'auto',
        sameSite: 'lax'
    },
    proxy: true // Tell express-session to trust the proxy
}));

// Session debug middleware (helpful for troubleshooting Cloudflare issues)
app.use((req, res, next) => {
    // Log session info for debugging (remove in production if needed)
    if (process.env.DEBUG_SESSIONS === 'true') {
        console.log('Session Debug:', {
            sessionID: req.sessionID,
            protocol: req.protocol,
            secure: req.secure,
            ip: req.ip,
            xff: req.get('X-Forwarded-For'),
            xfp: req.get('X-Forwarded-Proto'),
            cfRay: req.get('CF-Ray'), // Cloudflare specific header
            cfConnectingIP: req.get('CF-Connecting-IP') // Real visitor IP from Cloudflare
        });
    }
    next();
});

// Session cleanup handler
app.use((req, res, next) => {
    // Create session folder if it doesn't exist
    if (req.session && req.sessionID) {
        getSessionFolder(req.sessionID);
    }
    next();
});

app.use(express.static(__dirname));
app.use('/generated', express.static(generatedDir)); // Serve generated images statically
app.use(express.json({ limit: '10mb' }));

app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' https://accounts.google.com; connect-src 'self' https://generativelanguage.googleapis.com;");
  next();
});

// --- ROUTES ---
app.get(['/', '/combinations'], (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/analyzer', (req, res) => {
    res.sendFile(path.join(__dirname, 'analyzer.html'));
});

// --- ANALYTICS ENDPOINTS (PostgreSQL) ---

// Track user entry and update userActions
app.post('/api/track/visit', async (req, res) => {
    try {
        if (!dbConnected) {
            console.log('Database not connected, attempting to reconnect...');
            await connectDB();
            if (!dbConnected) {
                return res.status(503).json({ error: 'Database connection not available' });
            }
        }

        // Use session ID to uniquely identify users
        const userId = req.sessionID || 'anonymous';
        const userAgent = req.headers['user-agent'];
        
        // Insert visit record
        await pgPool.query(
            'INSERT INTO visits (user_id, user_agent) VALUES ($1, $2)',
            [userId, userAgent]
        );
        
        // Upsert userActions entry
        await pgPool.query(`
            INSERT INTO user_actions (user_id, entry_timestamp, generate_count)
            VALUES ($1, NOW(), 0)
            ON CONFLICT (user_id) DO NOTHING
        `, [userId]);
        
        res.json({ success: true, sessionId: userId });
    } catch (error) {
        console.error('Error tracking visit:', error);
        res.status(500).json({ error: 'Failed to track visit' });
    }
});


app.post('/api/track/color', async (req, res) => {
    try {
        if (!dbConnected) {
            console.log('Database not connected, attempting to reconnect...');
            await connectDB();
            if (!dbConnected) {
                return res.status(503).json({ error: 'Database connection not available' });
            }
        }

        const { colorData, source } = req.body;
        
        // Only track colors from analyzer page, not combinations page
        if (source !== 'analyzer') {
            return res.json({ 
                success: true, 
                message: 'Color tracking only enabled for analyzer page' 
            });
        }
        
        // Session ID available if needed for future per-user color tracking
        const userId = req.sessionID || 'anonymous';
        
        // Update color count in color_stats table (upsert with increment)
        await pgPool.query(`
            INSERT INTO color_stats (name, hex, index, count, updated_at)
            VALUES ($1, $2, $3, 1, NOW())
            ON CONFLICT (name) 
            DO UPDATE SET 
                count = color_stats.count + 1,
                updated_at = NOW()
        `, [colorData.name, colorData.hex, colorData.index]);
        
        console.log('Color selection tracked from analyzer:', colorData);
        res.json({ success: true });
    } catch (error) {
        console.error('Error tracking color selection:', error);
        res.status(500).json({ error: 'Failed to track color selection' });
    }
});


app.post('/api/track/combination', async (req, res) => {
    try {
        if (!dbConnected) {
            console.log('Database not connected, attempting to reconnect...');
            await connectDB();
            if (!dbConnected) {
                return res.status(503).json({ error: 'Database connection not available' });
            }
        }

        const { combinationIndex, colors } = req.body;
        // Use session ID to uniquely identify users
        const userId = req.sessionID || 'anonymous';
        
        // Store combination selection with user info and timestamp
        await pgPool.query(
            'INSERT INTO combination_selections (combination_index, colors, user_id) VALUES ($1, $2, $3)',
            [combinationIndex, JSON.stringify(colors), userId]
        );
        
        // Increment generateCount for user
        await pgPool.query(`
            INSERT INTO user_actions (user_id, generate_count, last_generate_timestamp)
            VALUES ($1, 1, NOW())
            ON CONFLICT (user_id) 
            DO UPDATE SET 
                generate_count = user_actions.generate_count + 1,
                last_generate_timestamp = NOW()
        `, [userId]);
        
        res.json({ success: true, sessionId: userId });
    } catch (error) {
        console.error('Error tracking combination selection:', error);
        res.status(500).json({ error: 'Failed to track combination selection' });
    }
});

app.post('/api/track/gender', async (req, res) => {
    try {
        if (!dbConnected) {
            console.log('Database not connected, attempting to reconnect...');
            await connectDB();
            if (!dbConnected) {
                return res.status(503).json({ error: 'Database connection not available' });
            }
        }

        const { gender } = req.body;
        if (!gender) {
            return res.status(400).json({ error: 'Gender is required' });
        }

        // Increment gender count in gender_stats table
        await pgPool.query(`
            INSERT INTO gender_stats (gender, count, last_updated)
            VALUES ($1, 1, NOW())
            ON CONFLICT (gender) 
            DO UPDATE SET 
                count = gender_stats.count + 1,
                last_updated = NOW()
        `, [gender]);

        res.json({ success: true });
    } catch (error) {
        console.error('Error tracking gender:', error);
        res.status(500).json({ error: 'Failed to track gender' });
    }
});



// Test endpoint to check colorStats data
app.get('/api/test-color-stats', async (req, res) => {
    try {
        if (!dbConnected) {
            await connectDB();
            if (!dbConnected) {
                return res.status(503).json({ error: 'Database connection not available' });
            }
        }

        const colorStatsResult = await pgPool.query(
            'SELECT name, hex, index, count FROM color_stats ORDER BY count DESC, index ASC LIMIT 10'
        );
        
        const totalResult = await pgPool.query('SELECT COUNT(*) as total FROM color_stats');
        
        res.json({
            totalColors: parseInt(totalResult.rows[0].total),
            colorStats: colorStatsResult.rows
        });
    } catch (error) {
        console.error('Error fetching color stats:', error);
        res.status(500).json({ error: 'Failed to fetch color stats' });
    }
});

app.get('/api/analytics', async (req, res) => {
    try {
        if (!dbConnected) {
            console.log('Database not connected, attempting to reconnect...');
            await connectDB();
            if (!dbConnected) {
                return res.status(503).json({ error: 'Database connection not available' });
            }
        }

        // Get top colors (secondary sort by index for consistent ordering)
        const topColorsResult = await pgPool.query(
            'SELECT name, hex, index, count FROM color_stats ORDER BY count DESC, index ASC LIMIT 10'
        );
        
        // Get top combinations (aggregated, secondary sort by combination_index)
        const topCombinationsResult = await pgPool.query(`
            SELECT combination_index, colors, COUNT(*) as count
            FROM combination_selections
            GROUP BY combination_index, colors
            ORDER BY count DESC, combination_index ASC
            LIMIT 10
        `);
        
        // Get recent visits
        const recentVisitsResult = await pgPool.query(
            'SELECT user_id, timestamp, user_agent FROM visits ORDER BY timestamp DESC LIMIT 100'
        );
        
        // Get gender statistics
        const genderStatsResult = await pgPool.query(
            'SELECT gender, count FROM gender_stats ORDER BY count DESC'
        );
        
        // Get color statistics (secondary sort by index for consistent ordering)
        const colorStatsResult = await pgPool.query(
            'SELECT name, hex, index, count FROM color_stats ORDER BY count DESC, index ASC LIMIT 10'
        );

        res.json({
            topColors: topColorsResult.rows,
            topCombinations: topCombinationsResult.rows,
            recentVisits: recentVisitsResult.rows,
            genderStats: genderStatsResult.rows,
            colorStats: colorStatsResult.rows
        });
    } catch (error) {
        console.error('Error fetching analytics:', error);
        res.status(500).json({ error: 'Failed to fetch analytics' });
    }
});

// New endpoint for popular colors
app.get('/api/popular-colors', async (req, res) => {
    try {
        if (!dbConnected) {
            console.log('Database not connected, attempting to reconnect...');
            await connectDB();
            if (!dbConnected) {
                return res.status(503).json({ error: 'Database connection not available' });
            }
        }

        // Get most popular colors from color_stats
        // Secondary sort by index for consistent results when counts are tied
        const result = await pgPool.query(
            `SELECT name, hex, index, count as "selectionCount" 
             FROM color_stats 
             ORDER BY count DESC, index ASC 
             LIMIT 4`
        );

        res.json({ popularColors: result.rows });
    } catch (error) {
        console.error('Error fetching popular colors:', error);
        res.status(500).json({ error: 'Failed to fetch popular colors' });
    }
});

// New endpoint for popular combinations
app.get('/api/popular-combinations', async (req, res) => {
    try {
        if (!dbConnected) {
            console.log('Database not connected, attempting to reconnect...');
            await connectDB();
            if (!dbConnected) {
                return res.status(503).json({ error: 'Database connection not available' });
            }
        }

        // Aggregate combination selections to get most popular combinations
        // Secondary sort by combination_index for consistent results when counts are tied
        const result = await pgPool.query(`
            SELECT 
                combination_index as "combinationIndex",
                colors,
                COUNT(*) as "selectionCount",
                MAX(timestamp) as "lastSelected"
            FROM combination_selections
            GROUP BY combination_index, colors
            ORDER BY COUNT(*) DESC, combination_index ASC
            LIMIT 4
        `);

        res.json({ popularCombinations: result.rows });
    } catch (error) {
        console.error('Error fetching popular combinations:', error);
        res.status(500).json({ error: 'Failed to fetch popular combinations' });
    }
});

// --- API ENDPOINTS ---
app.post('/api/analyze-image', async (req, res) => {
    try {
        const { image, mimeType } = req.body;
        if (!image || !mimeType) return res.status(400).json({ error: 'Image data and mimeType are required.' });
        if (!GEMINI_API_KEY) return res.status(500).json({ error: 'API key not configured on the server.' });

        const API_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent`;
        const requestBody = {
            contents: [{
                parts: [{
                    text: `Persona
                        You are an expert color analyst specializing in the Wada Sanzo color palette. Analyze this image and identify the main colors present in the clothing. For each color, provide the closest matching color from the Wada Sanzo color palette. Do not say any information just give me direct answer from these color Hermosa Pink,Corinthian Pink,Cameo Pink,Fawn,Light Brown Drab,Coral Red,Fresh Color,Grenadine Pink,Eosine Pink,Spinel Red,Old Rose,Eugenia Red | A,Eugenia Red | B,Raw Sienna,Vinaceous Tawny,Jasper Red,Spectrum Red,Red Orange,Etruscan Red,Burnt Sienna,Ochre Red,Scarlet,Carmine,Indian Lake,Rosolanc Purple,Pomegranite Purple,Hydrangea Red,Brick Red,Carmine Red,Pompeian Red,Red,Brown,Hay's Russet,Vandyke Red,Pansy Purple,Pale Burnt Lake,Violet Red,Vistoris Lake,Sulpher Yellow,Pale Lemon Yellow,Naples Yellow,Ivory Buff,Seashell Pink,Light Pinkish Cinnamon,Pinkish Cinnamon,Cinnamon Buff,Cream Yellow,Golden Yellow,Vinaceous Cinnamon,Ochraceous Salmon,Isabella Color,Maple,Olive Buff,Ecru,Yellow,Lemon Yellow,Apricot Yellow,Pyrite Yellow,Olive Ocher,Yellow Ocher,Orange Yellow,Yellow Orange,Apricot Orange,Orange,Peach Red,English Red,Cinnamon Rufous,Orange Rufous,Sulphine Yellow,Khaki,Citron Yellow,Buffy Citrine,Dark Citrine,Light Grayish Olive,Krongbergs Green,Olive,Orange Citrine,Sudan Brown,Olive Green,Light Brownish Olive,Deep Grayish Olive,Pale Raw Umber,Sepia,Madder Brown,Mars Brown / Tobacco,Vandyke Brown,Turquoise Green,Glaucous Green,Dark Greenish Glaucous,Yellow Green,Light Green Yellow,Night Green,Olive Yellow,Artemesia Green,Andover Green,Rainette Green,Pistachio Green,Sea Green,Benzol Green,Light Porcelain Green,Green,Dull Viridian Green,Oil Green,Diamine Green,Cossack Green,Lincoln Green,Blackish Olive,Deep Slate Olive,Nile Blue,Pale King's Blue,Light Glaucous Blue,Salvia Blue,Cobalt Green,Calamine BLue,Venice Green,Cerulian Blue,Peacock Blue,Green Blue,Olympic Blue,Blue,Antwarp Blue,Helvetia Blue,Dark Medici Blue,Dusky Green,Deep Lyons Blue,Violet Blue,Vandar Poel's Blue,Dark Tyrian Blue,Dull Violet Black,Deep Indigo,Deep Slate Green,Grayish Lavender - A,Grayish Lavender - B,Laelia Pink,Lilac,Eupatorium Purple,Light Mauve,Aconite Violet,Dull Blue Violet,Dark Soft Violet,Blue Violet,Purple Drab,Deep Violet / Plumbeous,Veronia Purple,Dark Slate Purple,Taupe Brown,Violet Carmine,Violet,Red Violet,Cotinga Purple,Dusky Madder Violet,White,Neutral Gray,Mineral Gray,Warm Gray,Slate Color,Black
                        Rules for Analysis & Output
                        Strict Output Format: Your entire output must only be a list using the exact format clothing_item: Color. After listing all clothing items, add a new line for the gender using the exact format gender: Male/Female. 
                        Find exact type of clothing item and match it with the identified color.
                        No Extra Text or Explanation: Under no circumstances should you add any introductory text, explanations, summaries, bullet points, or closing remarks. Your response must begin directly with the first clothing item and end with the last line (gender).`
                }, {
                    inline_data: { mime_type: mimeType, data: image }
                }]
            }]
        };
        const googleResponse = await fetchWithTimeout(API_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json','x-goog-api-key': GEMINI_API_KEY},
            body: JSON.stringify(requestBody)
        }, 30000); // 30 second timeout
        
        if (!googleResponse.ok) throw new Error(`Google API Error: ${googleResponse.status} ${await googleResponse.text()}`);     
        const responseData = await googleResponse.json();
        
        // Log the response text content
        const textResponse = responseData.candidates?.[0]?.content?.parts?.[0]?.text;
        if (textResponse) {
            console.log('Color Analysis Response:', textResponse);

        } else {
            console.log('No text response found in the API response');
        }
        
        res.json(responseData);
    } catch (error) {
        console.error('Error in image analysis proxy:', error);
        
        if (error.message === 'API_TIMEOUT') {
            return res.status(504).json({ 
                error: 'The analysis service is taking too long to respond. Please try again.',
                userMessage: 'Analysis service timeout. Please try again in a moment.'
            });
        }
        
        if (error.message && error.message.includes('fetch failed')) {
            return res.status(503).json({ 
                error: 'Unable to reach the analysis service. Please check your connection and try again.',
                userMessage: 'Service unavailable. Please try again later.'
            });
        }
        
        res.status(500).json({ 
            error: 'Failed to analyze image.',
            userMessage: 'An error occurred during analysis. Please try again.'
        });
    }
});

// Analyze generated outfit to describe clothing items in Turkish
app.post('/api/analyze-outfit-turkish', async (req, res) => {
    try {
        const { image, mimeType } = req.body;
        if (!image || !mimeType) {
            return res.status(400).json({ error: 'Image data and mimeType are required.' });
        }
        if (!GEMINI_API_KEY) {
            return res.status(500).json({ error: 'API key not configured on the server.' });
        }

        const API_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
        const requestBody = {
            contents: [{
                parts: [{
                    text: `For each item, provide the following details:
                            1.  **type**: Giysinin spesifik türü (ör., "t-shirt", "bluz", "kot pantolon", "spor ayakkabı", "kemer").
                            2.  **color**: Giysinin ana renginin/renklerinin kısa bir açıklaması.
                            3.  **style_details**: Giysinin kilit tasarım unsurlarından en belirgin özelliğini (ör., "dar kesim, pamuklu, bisiklet yaka", "A-kesim, ipek, çiçek desenli").
                            4.  **style_category**: Bu giysinin ait olduğu genel moda stili (e.g., "Casual", "Business", "Elegant", "Sporty", "Vintage").
                            5.  **features**: Ayırt edici, gözlemlenebilir özelliklerin bir listesi (ör., "önden düğmeli", "fermuarlı cepler", "kontrast dikiş").
                            ÖNEMLİ: *Yalnızca* geçerli bir JSON nesnesi döndürmelisiniz. 
                            JSON'dan önce veya sonra herhangi bir giriş metni, açıklama veya Markdown formatlaması (json gibi) eklemeyin. 
                            JSON nesnesini tam olarak bu yapıyı kullanarak döndürün:
                            {
                            "gender": "male",
                            "items": [
                                {
                                "type": "t-shirt",
                                "color": "açık mavi",
                                "style_details": "bisiklet yaka, kısa kollu, pamuklu",
                                "style_category": "Casual",
                                "features": "cepsiz, sade tasarım"
                                }
                            ]
                            }
                            YANIT OLARAK SADECE ham JSON nesnesini döndürün. Yanıt Türkçe olmalıdır`
                }, {
                    inline_data: { mime_type: mimeType, data: image }
                }]
            }]
        };

        const googleResponse = await fetchWithTimeout(API_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        }, 30000); // 30 second timeout

        if (!googleResponse.ok) {
            throw new Error(`Google API Error: ${googleResponse.status} ${await googleResponse.text()}`);
        }

        const responseData = await googleResponse.json();
        const textResponse = responseData.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (textResponse) {
            //console.log('Outfit Analysis Response (Turkish):', textResponse);
            try {
                // Clean the response to extract JSON from markdown
                let cleanedResponse = textResponse.trim();
                
                // Remove markdown code blocks if present
                if (cleanedResponse.startsWith('```json')) {
                    cleanedResponse = cleanedResponse.replace(/^```json\s*/, '').replace(/\s*```$/, '');
                } else if (cleanedResponse.startsWith('```')) {
                    cleanedResponse = cleanedResponse.replace(/^```\s*/, '').replace(/\s*```$/, '');
                }
                
                // Try to find JSON object in the response
                const jsonMatch = cleanedResponse.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    cleanedResponse = jsonMatch[0];
                }
                
                const itemsData = JSON.parse(cleanedResponse);
                console.log('Parsed gender from API:', itemsData.gender);
                
                // Convert items to search format
                const searchQueries = itemsData.items.map(item => {
                    const searchQuery = `${item.color} ${item.style} ${item.brand_style} ${item.type}`;
                    return {
                        original: item,
                        searchQuery: searchQuery
                    };
                });
                
                res.json({
                    gender: itemsData.gender,
                    items: itemsData.items,
                    searchQueries: searchQueries
                });
            } catch (parseError) {
                console.error('Error parsing outfit analysis:', parseError);
                console.error('Raw response:', textResponse);
                res.status(500).json({ 
                    error: 'Failed to parse outfit analysis',
                    userMessage: 'Could not process the analysis results. Please try again.'
                });
            }
        } else {
            res.status(500).json({ 
                error: 'No analysis response received',
                userMessage: 'No response from analysis service. Please try again.'
            });
        }
    } catch (error) {
        console.error('Error in outfit analysis:', error);
        
        if (error.message === 'API_TIMEOUT') {
            return res.status(504).json({ 
                error: 'The outfit analysis service is taking too long to respond. Please try again.',
                userMessage: 'Service timeout. Please try again in a moment.'
            });
        }
        
        if (error.message && error.message.includes('fetch failed')) {
            return res.status(503).json({ 
                error: 'Unable to reach the outfit analysis service. Please check your connection and try again.',
                userMessage: 'Service unavailable. Please try again later.'
            });
        }
        
        res.status(500).json({ 
            error: 'Failed to analyze outfit items.',
            userMessage: 'An error occurred during outfit analysis. Please try again.'
        });
    }
});

// Search for clothing items on Trendyol and Zara
app.post('/api/search-clothing-sites', async (req, res) => {
    try {
        const { items, gender } = req.body;
        
        if (!items || !Array.isArray(items)) {
            return res.status(400).json({ error: 'Items array is required' });
        }

        const searchResults = [];
        
        for (const item of items) {
            const itemResults = await searchItemOnSites(item, gender);
            searchResults.push({
                item: item,
                searchResults: itemResults
            });
        }

        res.json({ searchResults });
    } catch (error) {
        console.error('Error searching clothing items:', error);
        res.status(500).json({ error: 'Failed to search clothing items' });
    }
});

// Helper function to search for a single item on sites
async function searchItemOnSites(item, gender) {
    const searchResults = [];
    
    // Normalize gender to lowercase for comparison
    const genderLower = gender ? gender.toLowerCase() : '';
    const isFemale = genderLower === 'female' || genderLower === 'kadın' || genderLower === 'woman';
    
    try {
        // Generate Trendyol URL
        const trendyolQuery = generateSiteSearchQuery(item, null, gender);
        const wg = isFemale ? '1' : '2'; // wg=1 for women, wg=2 for men
        const trendyolUrl = `https://www.trendyol.com/sr?wg=${wg}&qt=${encodeURIComponent(trendyolQuery)}&st=${encodeURIComponent(trendyolQuery)}&os=1&q=${encodeURIComponent(trendyolQuery)}`;
        //console.log('gender:', gender);

        //console.log('Trendyol Search URL:', trendyolUrl);

        searchResults.push({
            site: 'Trendyol',
            domain: 'trendyol.com.tr',
            searchUrl: trendyolUrl,
            query: trendyolQuery
        });
    } catch (error) {
        console.error('Search failed for Trendyol:', error);
    }
    
    try {
        // Generate Zara URL
        const zaraQuery = generateSiteSearchQuery(item, null, gender);
        const section = isFemale ? 'WOMAN' : 'MAN';
        const zaraUrl = `https://www.zara.com/tr/en/search?searchTerm=${encodeURIComponent(zaraQuery)}&section=${section}`;
        //console.log('section:', section);
        //console.log('zaraQuery:', zaraQuery);
        //console.log('Zara Search URL:', zaraUrl);
        searchResults.push({
            site: 'Zara',
            domain: 'zara.com',
            searchUrl: zaraUrl,
            query: zaraQuery
        });
    } catch (error) {
        console.error('Search failed for Zara:', error);
    }
    
    return searchResults;
}

// Generate search query for a clothing item and site
function generateSiteSearchQuery(item, site, gender) {
    // Just parse and use the data directly
    const searchTerms = [];
    
        // Add color
    if (item.color) {
        searchTerms.push(item.color);
    }

    // Add item type
    if (item.type) {
        searchTerms.push(item.type);
    }

    // Add style category
    //if (item.style_category) {
    //    searchTerms.push(item.style_category);
    //}


    return searchTerms.join(' ');
}

// These translation functions are no longer needed since the API already returns Turkish terms

// Endpoint to cleanup session images (called when user closes/leaves)
app.post('/api/cleanup-session', (req, res) => {
    if (req.session && req.sessionID) {
        cleanupSessionImages(req.sessionID);
        res.json({ success: true, message: 'Session images cleaned up' });
    } else {
        res.json({ success: false, message: 'No session found' });
    }
});

// Endpoint to get session info (for debugging)
app.get('/api/session-info', (req, res) => {
    if (req.session && req.sessionID) {
        const sessionFolder = path.join(generatedDir, req.sessionID);
        let images = [];
        
        if (fs.existsSync(sessionFolder)) {
            images = fs.readdirSync(sessionFolder);
        }
        
        res.json({
            sessionId: req.sessionID,
            imageCount: images.length,
            images: images,
            folderPath: `/generated/${req.sessionID}`
        });
    } else {
        res.json({ message: 'No session found' });
    }
});

// Endpoint to get all generated images for current session
app.get('/api/session-images', (req, res) => {
    if (req.session && req.sessionID) {
        const sessionFolder = path.join(generatedDir, req.sessionID);
        
        if (fs.existsSync(sessionFolder)) {
            try {
                const files = fs.readdirSync(sessionFolder);
                const images = files
                    .filter(file => file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.jpeg'))
                    .map(file => {
                        const filePath = path.join(sessionFolder, file);
                        const stats = fs.statSync(filePath);
                        return {
                            filename: file,
                            url: `/generated/${req.sessionID}/${file}`,
                            timestamp: stats.mtimeMs,
                            size: stats.size
                        };
                    })
                    .sort((a, b) => b.timestamp - a.timestamp); // Sort by newest first
                
                res.json({
                    sessionId: req.sessionID,
                    images: images,
                    count: images.length
                });
            } catch (error) {
                console.error('Error reading session images:', error);
                res.status(500).json({ error: 'Failed to read session images' });
            }
        } else {
            res.json({
                sessionId: req.sessionID,
                images: [],
                count: 0
            });
        }
    } else {
        res.status(401).json({ error: 'No session found' });
    }
});

// Endpoint to delete a specific image
app.delete('/api/session-images/:filename', (req, res) => {
    if (req.session && req.sessionID) {
        const filename = req.params.filename;
        const sessionFolder = path.join(generatedDir, req.sessionID);
        const filePath = path.join(sessionFolder, filename);
        
        // Security check: ensure the file is within the session folder
        if (!filePath.startsWith(sessionFolder)) {
            return res.status(403).json({ error: 'Access denied' });
        }
        
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                console.log(`Deleted image: ${filename}`);
                res.json({ success: true, message: 'Image deleted' });
            } else {
                res.status(404).json({ error: 'Image not found' });
            }
        } catch (error) {
            console.error('Error deleting image:', error);
            res.status(500).json({ error: 'Failed to delete image' });
        }
    } else {
        res.status(401).json({ error: 'No session found' });
    }
});

app.post('/api/generate-image', async (req, res) => {
    try {
        const { image, mimeType, clothesToKeep, combination, style = 'casual' } = req.body;
        if (!image || !mimeType || !clothesToKeep || !combination) {
            return res.status(400).json({ error: 'Missing required parameters.' });
        }
        
        // --- TESTING MODE: Use local generated.png instead of API ---
        const USE_MOCK_IMAGE = process.env.USE_MOCK_IMAGE === 'True';
        if (USE_MOCK_IMAGE) {
            try {
                const mockImagePath = path.join(__dirname, 'generated.png');
                const imageBuffer = fs.readFileSync(mockImagePath);
                const base64Image = imageBuffer.toString('base64');
                
                console.log("TESTING MODE: Using local generated.png file");
                
                // Simulate API delay for realistic testing
                await new Promise(resolve => setTimeout(resolve, 2000));
                
                // Get or create session folder
                const sessionFolder = getSessionFolder(req.sessionID);
                
                // Save the image to session folder with unique filename
                const timestamp = Date.now();
                const uniqueFilename = `outfit_${timestamp}.png`;
                const savedImagePath = path.join(sessionFolder, uniqueFilename);
                fs.writeFileSync(savedImagePath, imageBuffer);
                
                const imageUrl = `/generated/${req.sessionID}/${uniqueFilename}`;
                console.log(`Image saved to: ${imageUrl}`);
                
                return res.json({
                    message: "Image generated successfully! (TESTING MODE)",
                    imageData: base64Image,
                    mimeType: 'image/png',
                    imageUrl: imageUrl,
                    filename: uniqueFilename,
                    sessionId: req.sessionID
                });
            } catch (mockError) {
                console.error('Error reading mock image:', mockError);
                return res.status(500).json({ 
                    error: 'Mock image file not found.',
                    userMessage: 'Testing image file not found. Please check generated.png exists.'
                });
            }
        }
        
        // --- PRODUCTION MODE: Use real API ---
        if (!GEMINI_API_KEY) { // Use the correct, single API key variable
            return res.status(500).json({ error: 'API key not configured.' });
        }

        // --- START: CORRECTED CODE ---
        // Use a valid image generation model and the correct API key variable
        const API_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${GEMINI_BANANA_KEY}`;        // --- END: CORRECTED CODE ---

        const clothesToKeepString = clothesToKeep.join(', ');
        const combinationColors = combination.names.join(', ');
        
        // Style-specific instructions
        const styleInstructions = {
            casual:	"Create a relaxed, comfortable, and everyday casual outfit. Use casual cuts, comfortable fabrics, and laid-back styling.",
            formal:	"Create an elegant, sophisticated formal outfit suitable for special occasions. Use refined cuts, premium fabrics, and polished styling.",
            business:	"Create a professional, office-appropriate business outfit. Use structured cuts, professional fabrics, and clean, polished styling.",
            //creative:	"Create an artistic, expressive, and unique creative outfit. Use bold cuts, interesting textures, and avant-garde styling.",
            elegant:	"Create a refined, graceful, and sophisticated elegant outfit. Use flowing cuts, luxurious fabrics, and refined styling.",
            sporty:	"Create an athletic, comfortable, and performance-inspired sporty outfit. Use functional cuts, technical fabrics, and active styling.",
            //business_casual: "Create a comfortable yet professional business casual outfit. Use tailored but relaxed cuts, quality fabrics, and smart, balanced styling.",
            //streetwear:	"Create a trendy, urban, and culture-inspired streetwear outfit. Use oversized or relaxed cuts, durable fabrics (like denim/fleece), and bold, statement styling.",
            //minimalist:	"Create a simple, refined, and understated minimalist outfit. Use clean, architectural cuts, high-quality solid fabrics, and uncluttered styling.",
            vintage:	"Create a nostalgic, period-accurate vintage outfit inspired by the fashion of a specific past decade. Use historical cuts, era-specific fabrics, and retro styling."
        };
        
        const stylePrompt = styleInstructions[style] || styleInstructions.casual;
        
        const prompt = `
            1.  **CHANGE THE BACKGROUND:** Replace the original background with a minimalist, seamless light grey studio backdrop.
            2.  **APPLY A NEW OUTFIT (Wada Sanzo Inspired):** All clothing items on the person, **EXCEPT FOR THE ${clothesToKeepString.toUpperCase()}**, must be replaced with a **completely new, stylish outfit.**
                - This new outfit should be creatively designed, drawing inspiration from the aesthetic and color harmony of **A Dictionary of Color Combinations (Wada Sanzo), specifically referencing Combination ${combination.index}: ${combinationColors}.**                
                - The AI should interpret this palette and design a harmonious ensemble (e.g., trousers, jacket, skirt, shoes, accessories as appropriate) that utilizes the ${combinationColors} colors in a sophisticated and balanced way across the new garments. The specific distribution of these colors across the new items is left to the AI's creative interpretation to best reflect the Wada Sanzo style.
            
            **STYLE REQUIREMENT: FORMAL AND STRUCTURED ADHERENCE**
            **STRICTLY APPLY THE FOLLOWING STYLE:** ${stylePrompt}
            **MANDATORY CLARIFIER:** The style must be interpreted as its most formal, traditional, and structured representation (e.g., if 'Business' is chosen, it must be 'Business Formal' with tailored garments and sharp silhouettes. If 'Streetwear' is chosen, it must be the most recognized, classic form of that style). DO NOT default to a 'casual' or 'comfort-focused' interpretation of the style.
            
                **ALL other elements from the reference image MUST be preserved and remain UNCHANGED:**
            1.  **DO NOT CHANGE THE SPECIFIED CLOTHES TO KEEP:** The **${clothesToKeepString.toUpperCase()}** MUST remain IDENTICAL to the one worn in the reference photo. Do not alter its original color, pattern, texture, or fit in any way.
            2.  **DO NOT CHANGE THE PERSON:** The person/model from the reference image, including their hair, skin tone, and facial expression, must be the exact same.
            3.  **DO NOT CHANGE THE POSE AND COMPOSITION:** The person's pose, their orientation within the frame, and the camera angle/framing of the shot must be exactly the same as in the reference photo.
            4.  **MAINTAIN ORIGINAL LIGHTING AND STYLE:** Preserve the original lighting direction, shadows, highlights, and overall photographic style. The new light grey studio background should be lit evenly and consistently with the original lighting on the person.
        `;

    //console.log('Image Generation Prompt:', prompt);
        //console.log('Sending image generation request to Google API...');
        //console.log('Prompt:', prompt);
        const requestBody = { 
            contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: image } }] }],
            generationConfig: {
                responseModalities: ["IMAGE", "TEXT"] // Requesting both is a safe practice
            }
        };
        const googleResponse = await fetchWithTimeout(API_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        }, 60000); // 60 second timeout for image generation (takes longer)
        
        const data = await googleResponse.json();

        if (!googleResponse.ok) {
            console.error("Google API Error during test:", data);
            return res.status(500).json({ 
                message: "Google API returned an error", 
                details: data,
                userMessage: 'Image generation failed. Please try again.'
            });
        }
        
        const imagePart = data.candidates?.[0]?.content?.parts?.find(part => part.inlineData);
        // for (const part of data.candidates[0].content.parts) {
        //     if (part.text) {
        //     console.log(part.text);
        //     } else if (part.inlineData) {
        //     const imageData = part.inlineData.data;
        //     const buffer = Buffer.from(imageData, "base64");
        //     fs.writeFileSync("gemini-native-image.png", buffer);
        //     console.log("Image saved as gemini-native-image.png");
        //     }
        // }
        
        if (imagePart) {
            console.log("SUCCESS: Image data found in API response.");
            
            // Get or create session folder
            const sessionFolder = getSessionFolder(req.sessionID);
            
            // Save the image to session folder with unique filename
            const timestamp = Date.now();
            const uniqueFilename = `outfit_${timestamp}.png`;
            const savedImagePath = path.join(sessionFolder, uniqueFilename);
            const imageBuffer = Buffer.from(imagePart.inlineData.data, 'base64');
            fs.writeFileSync(savedImagePath, imageBuffer);
            
            const imageUrl = `/generated/${req.sessionID}/${uniqueFilename}`;
            console.log(`Image saved to: ${imageUrl}`);
            
            // Send back the image data and URL
            res.json({
                message: "Image generated successfully!",
                imageData: imagePart.inlineData.data,
                mimeType: imagePart.inlineData.mimeType,
                imageUrl: imageUrl,
                filename: uniqueFilename,
                sessionId: req.sessionID
            });
        } else {
            console.error("FAILURE: API ran but did not return image data.", JSON.stringify(data, null, 2));
            res.status(500).json({ 
                message: "FAILURE: API ran but did not return image data.", 
                response: data,
                userMessage: 'Image generation incomplete. Please try again.'
            });
        }

    } catch (error) {
        console.error('Error in /generate route:', error);
        
        if (error.message === 'API_TIMEOUT') {
            return res.status(504).json({ 
                error: 'Image generation is taking too long. Please try again.',
                userMessage: 'Generation timeout. Please try again with a simpler request.'
            });
        }
        
        if (error.message && error.message.includes('fetch failed')) {
            return res.status(503).json({ 
                error: 'Unable to reach the image generation service. Please check your connection and try again.',
                userMessage: 'Service unavailable. Please try again later.'
            });
        }
        
        res.status(500).json({ 
            error: 'An internal server error occurred.',
            userMessage: 'Image generation failed. Please try again.'
        });
    }
});
const startServer = async () => {
  try {
    // Connect to Redis first
    console.log('Connecting to Redis...');
    await redisClient.connect();
    console.log('Redis client connected successfully');
    
    // Read API keys from environment variables
    GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    GEMINI_BANANA_KEY = process.env.GEMINI_BANANA_KEY;
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not found in environment variables.');
    if (!GEMINI_BANANA_KEY) throw new Error('GEMINI_BANANA_KEY not found in environment variables.');
    console.log('Successfully loaded API keys from environment variables.');
    
    app.listen(PORT, () => console.log(`API is running on port ${PORT}`));
  } catch (error) {
    console.error('Failed to initialize server:', error);
    process.exit(1);
  }
};

startServer();