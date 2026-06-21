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

// ১. গ্লোবাল টোকেন ভেরিফিকেশন মিডলওয়্যার
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer")) {
    return res.status(401).json({ msg: "Unauthorized" });
  }

  const token = authHeader.split(" ")[1]

  if (!token) {
    return res.status(401).json({ msg: "Unauthorized" });
  }

  try {
    const { payload } = await jwtVerify(token, JWKS)
    req.user = payload
    next()
  } catch (error) {
    console.log(error)
    return res.status(401).json({ msg: "Unauthorized" })
  }
}

// ২. রোল-বেসড মিডলওয়্যারসমূহ
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

async function run() {
  try {
    await client.connect();
    
    const db = client.db("skillswap");
    const usersCollection = db.collection("users");
    const tasksCollection = db.collection("tasks");
    const proposalsCollection = db.collection("proposals");
    const paymentsCollection = db.collection("payments");

    
    app.get("/client-stats", verifyToken, clientVerify, async (req, res) => {
      try {
        const email = req.user.email;

        // ক্লায়েন্টের মোট পোস্ট করা টাস্কের সংখ্যা
        const totalTasks = await tasksCollection.countDocuments({ client_email: email });
        
        // ওপেন টাস্কের সংখ্যা
        const openTasks = await tasksCollection.countDocuments({ client_email: email, status: "open" });
        
        // ইন প্রগ্রেস টাস্কের সংখ্যা
        const inProgressTasks = await tasksCollection.countDocuments({ client_email: email, status: "In Progress" });

        // মোট কত খরচ করেছে (Total Spent) - পেমেন্ট কালেকশন থেকে সামেশন
        const payments = await paymentsCollection.find({ clientEmail: email }).toArray();
        const totalSpent = payments.reduce((sum, payment) => sum + (payment.amount || 0), 0);

        res.json({
          totalTasks,
          openTasks,
          inProgressTasks,
          totalSpent
        });
      } catch (error) {
        res.status(500).json({ msg: "Error fetching stats", error: error.message });
      }
    });


    // [REQ 2] ক্লায়েন্ট নতুন টাস্ক পোস্ট করার জন্য API (POST API)
    app.post("/tasks", verifyToken, clientVerify, async (req, res) => {
      try {
        const data = req.body;
        
        const newTask = {
          title: data.title,
          category: data.category, // ফ্রন্টএন্ড মোডাল অনুযায়ী ক্যাটাগরি
          description: data.description,
          budget: Number(data.budget),
          deadline: data.deadline, // ফ্রন্টএন্ড মোডাল অনুযায়ী ডেডলাইন
          image: data.image || "",
          client_id: req.user.id || req.user.sub,
          client_email: req.user.email,
          status: "open", // ডকস অনুযায়ী ডিফল্ট স্ট্যাটাস অবশ্যই 'open' হবে
          createdAt: new Date()
        };

        const result = await tasksCollection.insertOne(newTask);
        res.status(201).send(result);
      } catch (error) {
        res.status(500).json({ msg: "Internal Server Error", error: error.message });
      }
    });


    // [REQ 3] ক্লায়েন্টের নিজের পোস্ট করা সব টাস্ক দেখার API (My Tasks View)
    app.get("/client-tasks", verifyToken, clientVerify, async (req, res) => {
      try {
        const email = req.user.email;
        const result = await tasksCollection.find({ client_email: email }).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).json({ msg: "Error fetching tasks", error: error.message });
      }
    });

    // ==========================================
    // 🟢টাস্ক ডিলিট করার API (Delete Task)
    // ==========================================
    app.delete("/tasks/:id", verifyToken, clientVerify, async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };

        const task = await tasksCollection.findOne(query);
        if (!task) {
          return res.status(404).json({ msg: "Task not found" });
        }
        if (task.client_email !== req.user.email) {
          return res.status(403).json({ msg: "Forbidden: You can only delete your own tasks" });
        }

        const result = await tasksCollection.deleteOne(query);
        res.send(result);
      } catch (error) {
        res.status(500).json({ msg: "Error deleting task", error: error.message });
      }
    });

    // ==========================================
    // 🟢 টাস্ক আপডেট/এডিট করার API (Edit Task)
    // ==========================================
    app.patch("/tasks/:id", verifyToken, clientVerify, async (req, res) => {
      try {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        const data = req.body;

       
        const task = await tasksCollection.findOne(filter);
        if (!task) {
          return res.status(404).json({ msg: "Task not found" });
        }
        if (task.client_email !== req.user.email) {
          return res.status(403).json({ msg: "Forbidden: You can only edit your own tasks" });
        }

       
        const updatedDoc = {
          $set: {
            title: data.title,
            category: data.category,
            budget: Number(data.budget), 
            deadline: data.deadline,
          },
        };

        const result = await tasksCollection.updateOne(filter, updatedDoc);
        res.send(result);
      } catch (error) {
        res.status(500).json({ msg: "Error updating task", error: error.message });
      }
    });


    // [REQ 7] ফ্রিল্যান্সারদের জন্য সমস্ত Open টাস্ক দেখার API (Browse Tasks)
    app.get("/available-tasks", verifyToken, async (req, res) => {
      try {
        const result = await tasksCollection.find({ status: "open" }).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).json({ msg: "Error fetching available tasks", error: error.message });
      }
    });

    // [REQ 8] ফ্রিল্যান্সারদের প্রপোজাল সাবমিট করার সহজ ও ফুল-প্রুফ API
    app.post("/submit-proposal", verifyToken, async (req, res) => {
      try {
        const proposalInfo = {
          taskId: req.body.taskId,
          taskTitle: req.body.taskTitle,
          
          clientEmail: req.body.clientEmail || req.body.client_email, 
          freelancerEmail: req.user.email,
          freelancerName: req.user.name || "Freelancer",
          budget: Number(req.body.budget),
          duration: Number(req.body.duration),
          message: req.body.message,
          status: "Pending",
          createdAt: new Date()
        };

        const result = await proposalsCollection.insertOne(proposalInfo);
        
        
        res.status(201).send({ success: true, result });
      } catch (error) {
        
        console.error("Proposal insert failed:", error);
        res.status(500).send({ success: false, error: error.message });
      }
    });

    // [REQ 9] ফ্রিল্যান্সারদের নিজেদের পাঠানো প্রপোজাল লিস্ট দেখার API
    app.get("/my-proposals", verifyToken, async (req, res) => {
      try {
        const email = req.user.email; // টোকেন থেকে ফ্রিল্যান্সারের ইমেইল নিলাম
        const result = await proposalsCollection.find({ freelancerEmail: email }).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // [REQ 4] ক্লায়েন্টের নিজের টাস্কগুলোর প্রপোজাল দেখার API (Manage Proposals View)
    app.get("/client-proposals", verifyToken, clientVerify, async (req, res) => {
      try {
        const email = req.user.email;
        // যে টাস্কগুলো এই ক্লায়েন্ট পোস্ট করেছে, সেগুলোর ওপর আসা প্রপোজাল ফিল্টার
        const result = await proposalsCollection.find({ clientEmail: email }).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).json({ msg: "Error fetching proposals", error: error.message });
      }
    });


    // [REQ 5] প্রপোজাল রিজেক্ট করার API (Reject Proposal)
    app.patch("/proposals/reject/:id", verifyToken, clientVerify, async (req, res) => {
      try {
        const id = req.params.id;
        const result = await proposalsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status: "Rejected" } }
        );
        res.send(result);
      } catch (error) {
        res.status(500).json({ msg: "Error rejecting proposal", error: error.message });
      }
    });


    // [REQ 6] স্ট্রাইপ পেমেন্ট সফল হওয়ার পর ডাটা সেভ করার API (UPDATED)
    app.post("/payment/success", verifyToken, clientVerify, async (req, res) => {
      try {
        // ফ্রন্টএন্ড থেকে taskId এর পাশাপাশি proposalId-ও নিয়ে নিলাম
        const { sessionId, taskId, freelancerName, budget, taskTitle, proposalId } = req.body;

        const isExist = await paymentsCollection.findOne({ sessionId });
        if (isExist) {
          return res.json({ msg: "Payment record already exists!" });
        }

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

        // ১. পেমেন্ট সফল হলে টাস্ক আপডেট হয়ে "In Progress" হবে
        await tasksCollection.updateOne(
          { _id: new ObjectId(taskId) },
          { $set: { status: "In Progress" } }
        );

        // ২. ক্লায়েন্ট যে প্রপোজালটি সিলেক্ট করেছে সেটির স্ট্যাটাস হবে "Accepted"
        await proposalsCollection.updateOne(
          { _id: new ObjectId(proposalId) },
          { $set: { status: "Accepted" } }
        );

        // ৩. ডকসের মেইন শর্ত: এই টাস্কের বাকি সব প্রপোজাল একসাথে "Rejected" হয়ে যাবে!
        await proposalsCollection.updateMany(
          { taskId: taskId, _id: { $ne: new ObjectId(proposalId) } }, 
          { $set: { status: "Rejected" } }
        );

        res.json({ msg: "Payment recorded. Other proposals rejected!" });
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