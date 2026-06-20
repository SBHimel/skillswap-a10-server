const dns = require("node:dns");
dns.setServers(["1.1.1.1", "1.0.0.1"]);

const express = require("express");
const dontenv = require("dotenv");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { jwtVerify, createRemoteJWKSet } = require("jose-cjs");
dontenv.config();

const uri = process.env.MONGODB_URI;

const app = express();
const PORT = process.env.PORT || 5000;

app.use(
  cors({
    credentials: true,
    origin: [process.env.CLIENT_URL],
  }),
);
app.use(express.json());

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const JWKS = createRemoteJWKSet(new URL(`${process.env.CLIENT_URL}/api/auth/jwks`))

// ১. গ্লোবাল টোকেন ভেরিফিকেশন মিডলওয়্যার (ঠিক আছে)
const verifyToken = async (req, res, next) =>{
  const authHeader = req.headers.authorization;

  if(!authHeader || !authHeader.startsWith("Bearer")){
    return res.status(401).json({msg: "Unauthorized"});
  }

   const token = authHeader.split(" ")[1]

   if(!token){
    return res.status(401).json({msg: "Unauthorized"});
   }

   try{
    const {payload} = await jwtVerify(token, JWKS)
    req.user = payload
    next()
   }catch(error){
    console.log(error)
    return res.status(401).json({msg: "Unauthorized"})
   }
}

// ২. নতুন রোল-বেসড মিডলওয়্যারসমূহ (Role-based Middlewares)
const clientVerify = async (req, res, next) => {
  if (req.user.role !== "client") {
    return res.status(403).json({ msg: "Forbidden: Client Access Only" });
  }
  next();
};

const freelancerVerify = async (req, res, next) => {
  if (req.user.role !== "freelancer") {
    return res.status(403).json({ msg: "Forbidden: Freelancer Access Only" });
  }
  next();
};

const adminVerify = async (req, res, next) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ msg: "Forbidden: Admin Access Only" });
  }
  next();
};

async function run() {
  try {
    await client.connect();
    
    // ৩. ডাটাবেজ এবং কালেকশন রিনেম (SkillSwapDB অনুযায়ী)
    const db = client.db("SkillSwapDB");
    const usersCollection = db.collection("users");
    const tasksCollection = db.collection("tasks");
    const proposalsCollection = db.collection("proposals");
    const paymentsCollection = db.collection("payments");
    const reviewsCollection = db.collection("reviews");

    // ৪. ক্লায়েন্ট নতুন টাস্ক পোস্ট করার জন্য API (POST API)
    app.post("/tasks", verifyToken, clientVerify, async (req, res) => {
      try {
        const data = req.body;
        
        const newTask = {
          title: data.title,
          description: data.description,
          budget: Number(data.budget),
          image: data.image || "",
          client_id: req.user.id,
          client_email: req.user.email,
          status: data.status || "pending", // তোমার মোডাল অনুযায়ী 'pending' রাখা হলো
          createdAt: new Date()
        };

        const result = await tasksCollection.insertOne(newTask);
        res.status(201).send(result);
      } catch (error) {
        res.status(500).json({ msg: "Internal Server Error", error: error.message });
      }
    });

    // ৫. স্ট্রাইপ ডাইনামিক পেমেন্ট সফল হওয়ার পর ডাটা সেভ করার API
    app.post("/payment/success", verifyToken, clientVerify, async (req, res) => {
      try {
        const { sessionId, taskId, freelancerName, budget, taskTitle } = req.body;

        const isExist = await paymentsCollection.findOne({ sessionId });
        if (isExist) {
          return res.json({ msg: "Payment record already exists!" });
        }

        // পেমেন্ট কালেকশনে ডাটা ইনসার্ট
        const paymentInfo = {
          sessionId,
          taskId,
          taskTitle,
          clientEmail: req.user.email,
          freelancerName,
          amount: Number(budget),
          paidAt: new Date()
        };
        await paymentsCollection.insertOne(paymentInfo);

        // টাস্কের স্ট্যাটাস আপডেট করে "completed" বা "booked" করা
        await tasksCollection.updateOne(
          { _id: new ObjectId(taskId) },
          { $set: { status: "completed" } }
        );

        res.json({ msg: "Payment successfully recorded and task updated!" });
      } catch (error) {
        res.status(500).json({ msg: "Server Error", error: error.message });
      }
    });

    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Keeps connection alive
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("SkillSwap Server is running fine!");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});