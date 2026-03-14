const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

const DB_FILE = './rakib_db.json';
const API_URL = "https://image.mr4425390.workers.dev/";
const AUTH_TOKEN = "Bearer 01941429881@Aa";

// ১. ডাটাবেস সেফলি পড়ার ফাংশন (Fixes JSON SyntaxError)
function readDB() {
    try {
        if (!fs.existsSync(DB_FILE)) {
            const initial = { users: [], images: [], payments: [] };
            fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2));
            return initial;
        }
        const data = fs.readFileSync(DB_FILE, 'utf8').trim();
        if (!data) throw new Error("Empty File");
        return JSON.parse(data);
    } catch (e) {
        console.log("DB ফাইলটি করাপ্ট হয়েছে, ঠিক করা হচ্ছে...");
        const reset = { users: [], images: [], payments: [] };
        fs.writeFileSync(DB_FILE, JSON.stringify(reset, null, 2));
        return reset;
    }
}

function writeDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// ২. রেজিস্ট্রেশন রুট
app.post('/register', (req, res) => {
    const { username, password, fullName, dob, profilePic } = req.body;
    const db = readDB();

    if (db.users.find(u => u.username === username)) {
        return res.json({ success: false, message: "এই ইউজারনেম আগে থেকেই আছে!" });
    }

    const newUser = {
        username,
        password,
        fullName,
        dob,
        profilePic: profilePic || '',
        plan: 'Free',
        daily_limit: 5,
        used_today: 0,
        used_this_month: 0,
        total_generated: 0,
        status: 'active',
        expiry: 'Unlimited',
        joinDate: new Date().toISOString()
    };

    db.users.push(newUser);
    writeDB(db);
    res.json({ success: true });
});

// ৩. লগইন রুট
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const db = readDB();
    const user = db.users.find(u => u.username === username && u.password === password);

    if (!user) return res.json({ success: false, message: "ভুল তথ্য!" });
    if (user.status === 'blocked') return res.json({ success: false, message: "আপনার অ্যাকাউন্ট ব্লক করা!" });

    res.json({ success: true, user });
});

// ৪. ইমেজ জেনারেশন রুট
app.post('/generate', async (req, res) => {
    const { username, prompt } = req.body;
    const db = readDB();
    const user = db.users.find(u => u.username === username);

    if (!user) return res.json({ success: false, message: "ইউজার পাওয়া যায়নি" });
    if (user.used_today >= user.daily_limit) return res.json({ success: false, message: "আপনার আজকের লিমিট শেষ!" });

    try {
        const response = await axios({
            method: 'post',
            url: API_URL,
            headers: { 'Authorization': AUTH_TOKEN, 'Content-Type': 'application/json' },
            data: { prompt },
            responseType: 'stream'
        });

        const fileName = `rakib_${Date.now()}.jpg`;
        const dir = './public/history';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const filePath = path.join(dir, fileName);
        const writer = fs.createWriteStream(filePath);

        response.data.pipe(writer);

        writer.on('finish', () => {
            const imgData = {
                id: Date.now(),
                owner: username,
                url: `/history/${fileName}`,
                prompt,
                date: new Date().toISOString(),
                isPublic: false,
                likes: 0
            };
            db.images.push(imgData);
            user.used_today++;
            user.used_this_month++;
            user.total_generated++;
            writeDB(db);
            res.json({ success: true, image: imgData });
        });

    } catch (e) {
        res.json({ success: false, message: "এআই সার্ভারে সমস্যা হচ্ছে।" });
    }
});

// ৫. পেমেন্ট রিকোয়েস্ট
app.post('/pay-request', (req, res) => {
    const { username, trxid, plan } = req.body;
    const db = readDB();
    db.payments.push({ username, trxid, plan, status: 'Pending', date: new Date().toISOString() });
    writeDB(db);
    res.json({ success: true, message: "আপনার পেমেন্ট রিকোয়েস্ট সফল হয়েছে!" });
});

// ৬. গ্যালারিতে শেয়ার
app.post('/share-image', (req, res) => {
    const { imgId } = req.body;
    const db = readDB();
    const img = db.images.find(i => i.id == imgId);
    if (img) {
        img.isPublic = true;
        writeDB(db);
        res.json({ success: true });
    }
});

// ৭. অ্যাডমিন একশন (Approve/Block)
app.post('/admin/action', (req, res) => {
    const { adminPass, targetUser, action, planDetails } = req.body;
    if (adminPass !== 'rakib') return res.status(403).send("Unauthorized");

    const db = readDB();
    const user = db.users.find(u => u.username === targetUser);

    if (user) {
        if (action === 'block') user.status = 'blocked';
        if (action === 'unblock') user.status = 'active';
        if (action === 'approve') {
            user.plan = planDetails.name;
            user.daily_limit = planDetails.limit;
            user.expiry = planDetails.expiry;
            db.payments = db.payments.filter(p => p.username !== targetUser);
        }
        writeDB(db);
        res.json({ success: true });
    }
});

// ৮. অল ডেটা রুট (শুধুমাত্র ফ্রন্টএন্ডের জন্য)
app.get('/admin/data', (req, res) => res.json(readDB()));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ RAKIB AI Server is running on: http://localhost:${PORT}`);
});
