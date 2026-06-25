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

const JWKS = createRemoteJWKSet(
  new URL(`${process.env.CLIENT_URL}/api/auth/jwks`),
);

// ১. গ্লোবাল টোকেন ভেরিফিকেশন মিডলওয়্যার
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer")) {
    return res.status(401).json({ msg: "Unauthorized" });
  }

  const token = authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ msg: "Unauthorized" });
  }

  try {
    const { payload } = await jwtVerify(token, JWKS);
    req.user = payload;
    next();
  } catch (error) {
    console.log(error);
    return res.status(401).json({ msg: "Unauthorized" });
  }
};

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
    const usersCollection = db.collection("user");
    const tasksCollection = db.collection("tasks");
    const proposalsCollection = db.collection("proposals");
    const paymentsCollection = db.collection("payments");

    app.get("/client-stats", verifyToken, clientVerify, async (req, res) => {
      try {
        const email = req.user.email;

        const totalTasks = await tasksCollection.countDocuments({
          client_email: email,
        });

        const openTasks = await tasksCollection.countDocuments({
          client_email: email,
          status: "open",
        });

        const inProgressTasks = await tasksCollection.countDocuments({
          client_email: email,
          status: "In Progress",
        });

        const payments = await paymentsCollection
          .find({ clientEmail: email })
          .toArray();
        const totalSpent = payments.reduce(
          (sum, payment) => sum + (payment.amount || 0),
          0,
        );

        res.json({
          totalTasks,
          openTasks,
          inProgressTasks,
          totalSpent,
        });
      } catch (error) {
        res
          .status(500)
          .json({ msg: "Error fetching stats", error: error.message });
      }
    });

    // 🟢 [FREELANCER STATS] ফ্রিল্যান্সার ড্যাশবোর্ডের ৪টিカードের ডাটা কাউন্ট এপিআই
    app.get(
      "/freelancer-stats",
      verifyToken,
      freelancerVerify,
      async (req, res) => {
        try {
          const email = req.user.email;

          // ১. আলাদা আলাদা স্ট্যাটাস কাউন্ট করা
          const total = await proposalsCollection.countDocuments({
            freelancerEmail: email,
          });
          const pending = await proposalsCollection.countDocuments({
            freelancerEmail: email,
            status: "Pending",
          });
          const accepted = await proposalsCollection.countDocuments({
            freelancerEmail: email,
            status: "Accepted",
          });

          const acceptedList = await proposalsCollection
            .find({ freelancerEmail: email, status: "Accepted" })
            .toArray();
          const taskIds = acceptedList.map((p) => new ObjectId(p.taskId));

          const completedTasks = await tasksCollection
            .find({
              _id: { $in: taskIds },
              status: "Completed",
            })
            .toArray();

          const earnings = completedTasks.reduce(
            (sum, task) => sum + (Number(task.budget) || 0),
            0,
          );

          res.json({ total, pending, accepted, earnings });
        } catch (error) {
          res.status(500).json({
            msg: "Error fetching freelancer stats",
            error: error.message,
          });
        }
      },
    );

    //  নতুন এপিআই ১: [FREELANCER PROJECTS] একটিভ এবং কমপ্লিটেড প্রজেক্ট লিস্ট

    app.get(
      "/freelancer-projects",
      verifyToken,
      freelancerVerify,
      async (req, res) => {
        try {
          const email = req.user.email;

          const acceptedProposals = await proposalsCollection
            .find({
              freelancerEmail: email,
              status: "Accepted",
            })
            .toArray();

          if (acceptedProposals.length === 0) {
            return res.json([]);
          }

          const taskIds = acceptedProposals.map((p) => new ObjectId(p.taskId));
          const tasks = await tasksCollection
            .find({ _id: { $in: taskIds } })
            .toArray();

          const formattedProjects = tasks.map((task) => ({
            _id: task._id,
            title: task.title,
            budget: task.budget,
            clientEmail: task.client_email || task.clientEmail,
            status: task.status, // "In Progress" অথবা "Completed"
            deliverable_url: task.deliverableUrl || "",
          }));

          res.json(formattedProjects);
        } catch (error) {
          res.status(500).json({
            msg: "Error fetching freelancer projects",
            error: error.message,
          });
        }
      },
    );

    app.get("/freelancer/earnings", verifyToken, async (req, res) => {
      const email = req.user.email;
      const earnings = await proposalsCollection
        .find({
          freelancerEmail: email,
          status: "Accepted",
        })
        .toArray();

      res.json(earnings);
    });

    // প্রোফাইল ডাটা পাওয়ার জন্য
    app.get("/freelancer/profile/:email", verifyToken, async (req, res) => {
      const profile = await usersCollection.findOne({
        email: req.params.email,
      });
      res.json(profile);
    });

    // প্রোফাইল আপডেট করার জন্য PATCH রুট
    app.patch("/freelancer/profile/:email", verifyToken, async (req, res) => {
      const filter = { email: req.params.email };

      // শুধু যে ডাটাগুলো ফর্ম থেকে আসবে, সেগুলোই অবজেক্টে যোগ হবে
      const updateFields = {};
      if (req.body.name) updateFields.name = req.body.name;
      if (req.body.photo) updateFields.image = req.body.photo; // খালি থাকলে আগের ইমেজ মুছবে না
      if (req.body.hourlyRate) updateFields.hourlyRate = req.body.hourlyRate;
      if (req.body.bio) updateFields.bio = req.body.bio;
      if (req.body.skills) updateFields.skills = req.body.skills;

      const updatedDoc = { $set: updateFields };

      try {
        const result = await usersCollection.updateOne(filter, updatedDoc);
        if (result.matchedCount === 0) {
          return res.status(404).json({ message: "User not found!" });
        }
        res.json(result);
      } catch (error) {
        console.error("Database update error:", error);
        res.status(500).json({ message: "Internal server error" });
      }
    });

    // 🆕 🟢 নতুন এপিআই ২: [SUBMIT DELIVERABLE] প্রজেক্টের কাজ সাবমিট করা

    app.patch(
      "/tasks/:id/submit",
      verifyToken,
      freelancerVerify,
      async (req, res) => {
        try {
          const taskId = req.params.id;
          const { deliverableUrl } = req.body;

          if (!deliverableUrl) {
            return res
              .status(400)
              .json({ success: false, msg: "Deliverable URL is required!" });
          }

          // টাস্কের স্ট্যাটাস Completed করা এবং লিংক সেভ করা
          const result = await tasksCollection.updateOne(
            { _id: new ObjectId(taskId) },
            {
              $set: {
                status: "Completed",
                deliverableUrl: deliverableUrl,
              },
            },
          );

          if (result.modifiedCount > 0) {
            res.json({
              success: true,
              msg: "Deliverable submitted successfully! 🎉",
            });
          } else {
            res.status(404).json({
              success: false,
              msg: "Task not found or already completed.",
            });
          }
        } catch (error) {
          res.status(500).json({
            success: false,
            msg: "Server error",
            error: error.message,
          });
        }
      },
    );

    // [REQ 2] ক্লায়েন্ট নতুন টাস্ক পোস্ট করার জন্য API (POST API)
    app.post("/tasks", verifyToken, clientVerify, async (req, res) => {
      try {
        const data = req.body;

        const newTask = {
          title: data.title,
          category: data.category,
          description: data.description,
          budget: Number(data.budget),
          deadline: data.deadline,
          image: data.image || "",
          client_id: req.user.id || req.user.sub,
          client_email: req.user.email,
          status: "open",
          createdAt: new Date(),
        };

        const result = await tasksCollection.insertOne(newTask);
        res.status(201).send(result);
      } catch (error) {
        res
          .status(500)
          .json({ msg: "Internal Server Error", error: error.message });
      }
    });

    // [REQ 3] ক্লায়েন্টের নিজের পোস্ট করা সব টাস্ক দেখার API (My Tasks View)
    app.get("/client-tasks", verifyToken, clientVerify, async (req, res) => {
      try {
        const email = req.user.email;
        const result = await tasksCollection
          .find({ client_email: email })
          .toArray();
        res.send(result);
      } catch (error) {
        res
          .status(500)
          .json({ msg: "Error fetching tasks", error: error.message });
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
          return res
            .status(403)
            .json({ msg: "Forbidden: You can only delete your own tasks" });
        }

        const result = await tasksCollection.deleteOne(query);
        res.send(result);
      } catch (error) {
        res
          .status(500)
          .json({ msg: "Error deleting task", error: error.message });
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
          return res
            .status(403)
            .json({ msg: "Forbidden: You can only edit your own tasks" });
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
        res
          .status(500)
          .json({ msg: "Error updating task", error: error.message });
      }
    });

    // [REQ 7] ফ্রিল্যান্সারদের জন্য সমস্ত Open টাস্ক দেখার API (Browse Tasks)
    app.get("/available-tasks", verifyToken, async (req, res) => {
      try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 9;
        const search = req.query.search || "";
        const category = req.query.category || "";

        let query = { status: "open" };

        if (search) {
          query.title = { $regex: search, $options: "i" };
        }
        if (category && category !== "All") {
          query.category = category;
        }

        const skipAmount = (page - 1) * limit;

        const result = await tasksCollection
          .find(query)
          .skip(skipAmount)
          .limit(limit)
          .toArray();

        const totalTasks = await tasksCollection.countDocuments(query);
        const totalPages = Math.ceil(totalTasks / limit);

        res.send({
          tasks: result,
          totalPages: totalPages,
          currentPage: page,
        });
      } catch (error) {
        res.status(500).json({
          msg: "Error fetching available tasks",
          error: error.message,
        });
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
          createdAt: new Date(),
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
        const email = req.user.email;
        const result = await proposalsCollection
          .find({ freelancerEmail: email })
          .toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    // [REQ 4] ক্লায়েন্টের নিজের টাস্কগুলোর প্রপোজাল দেখার API (Manage Proposals View)
    app.get(
      "/client-proposals",
      verifyToken,
      clientVerify,
      async (req, res) => {
        try {
          const email = req.user.email;

          const result = await proposalsCollection
            .find({ clientEmail: email })
            .toArray();
          res.send(result);
        } catch (error) {
          res
            .status(500)
            .json({ msg: "Error fetching proposals", error: error.message });
        }
      },
    );

    // [REQ 5] প্রপোজাল রিজেক্ট করার API (Reject Proposal)
    app.patch(
      "/proposals/reject/:id",
      verifyToken,
      clientVerify,
      async (req, res) => {
        try {
          const id = req.params.id;
          const result = await proposalsCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: { status: "Rejected" } },
          );
          res.send(result);
        } catch (error) {
          res
            .status(500)
            .json({ msg: "Error rejecting proposal", error: error.message });
        }
      },
    );

    // [REQ 6] স্ট্রাইপ পেমেন্ট সফল হওয়ার পর ডাটা সেভ করার API (UPDATED)
    // [REQ 6] স্ট্রাইপ পেমেন্ট সফল হওয়ার পর ডাটা সেভ করার API (UPDATED WITH FREELANCER EMAIL)
    app.post(
      "/payment/success",
      verifyToken,
      clientVerify,
      async (req, res) => {
        try {
          const {
            sessionId,
            taskId,
            freelancerName,
            freelancerEmail,
            budget,
            taskTitle,
            proposalId,
          } = req.body;

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
            freelancerEmail,
            amount: Number(budget),
            paidAt: new Date(),
          };
          await paymentsCollection.insertOne(paymentInfo);

          await tasksCollection.updateOne(
            { _id: new ObjectId(taskId) },
            { $set: { status: "In Progress" } },
          );

          await proposalsCollection.updateOne(
            { _id: new ObjectId(proposalId) },
            { $set: { status: "Accepted" } },
          );

          await proposalsCollection.updateMany(
            { taskId: taskId, _id: { $ne: new ObjectId(proposalId) } },
            { $set: { status: "Rejected" } },
          );

          res.json({ msg: "Payment recorded. Other proposals rejected!" });
        } catch (error) {
          res.status(500).json({ msg: "Server Error", error: error.message });
        }
      },
    );

    // 🟢 ১. লেটেস্ট ৩টি ওপেন টাস্ক নিয়ে আসার API
    app.get("/tasks/open", async (req, res) => {
      try {
        const query = { status: "open" };
        const result = await tasksCollection
          .find(query)
          .sort({ _id: -1 })
          .limit(3)
          .toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: true, message: error.message });
      }
    });

    // 🟢 ২. টপ ৩টি ফ্রিল্যান্সার প্রোফাইল নিয়ে আসার API
    app.get("/users/freelancers", async (req, res) => {
      try {
        const query = { role: "freelancer" };
        const result = await usersCollection.find(query).limit(3).toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ error: true, message: error.message });
      }
    });

    // 🟢 ৩. প্ল্যাটফর্ম স্ট্যাটিস্টিকস (টোটাল কাউন্ট) API
    app.get("/platform-stats", async (req, res) => {
      try {
        const totalTasks = await tasksCollection.countDocuments();
        const totalUsers = await usersCollection.countDocuments();

        const payments = await paymentsCollection.find().toArray();
        const totalPayout = payments.reduce(
          (sum, p) => sum + (Number(p.amount) || 0),
          0,
        );

        res.send({
          totalTasks: totalTasks || 0,
          totalUsers: totalUsers || 0,
          totalPayout: totalPayout || 0,
        });
      } catch (error) {
        res.status(500).send({ error: true, message: error.message });
      }
    });

    // ==========================================
    // 🎯 SECTION 09: ADMIN DASHBOARD API ROUTES
    // ==========================================

    // ১. Admin Overview Stats
    app.get("/admin/stats", async (theme, res) => {
      try {
        // ডাটাবেজের কালেকশন থেকে টোটাল কাউন্ট বা সাম বের করা
        const totalUsers = await usersCollection.countDocuments();
        const totalTasks = await tasksCollection.countDocuments();
        const activeTasks = await tasksCollection.countDocuments({
          status: "open",
        });

        // টোটাল রেভিনিউ হিসেব করা (পেমেন্ট কালেকশনের সব 'amount' যোগ করে)
        const payments = await paymentsCollection.find().toArray();
        const totalRevenue = payments.reduce(
          (sum, payment) => sum + (payment.amount || 0),
          0,
        );

        res.send({
          totalUsers,
          totalTasks,
          activeTasks,
          totalRevenue,
        });
      } catch (error) {
        res.status(500).send({ message: "Stats আনতে সমস্যা হয়েছে", error });
      }
    });

    // ২. Manage Users — সব ইউজারের লিস্ট দেখা
    app.get("/admin/users", async (req, res) => {
      try {
        const result = await usersCollection.find().toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Users আনতে সমস্যা হয়েছে" });
      }
    });

    // ৩. Manage Users — ইউজার ব্লক/আনব্লক করা
    app.patch("/admin/users/:id/block", async (req, res) => {
      try {
        const userId = req.params.id;
        const { isBlocked } = req.body; // ফ্রন্টএন্ড থেকে পাঠানো true/false

        const filter = { _id: new ObjectId(userId) };
        const updateDoc = {
          $set: { isBlocked: isBlocked },
        };

        const result = await usersCollection.updateOne(filter, updateDoc);
        res.send({ success: true, modifiedCount: result.modifiedCount });
      } catch (error) {
        res.status(500).send({ message: "User স্ট্যাটাস আপডেট করতে সমস্যা" });
      }
    });

    app.post("/admin/users/check-status", async (req, res) => {
      try {
        const foundUser = await db
          .collection("user")
          .findOne({ email: req.body.email });
        res.send({ isBlocked: foundUser?.isBlocked || false });
      } catch (error) {
        res.status(500).send({ isBlocked: false });
      }
    });

    // ৪. Manage Tasks — সব টাস্কের লিস্ট দেখা
    app.get("/admin/tasks", async (req, res) => {
      try {
        const result = await tasksCollection.find().toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Tasks আনতে সমস্যা হয়েছে" });
      }
    });

    // ৫. Manage Tasks — কোনো টাস্ক ডিলিট করা
    app.delete("/admin/tasks/:id", async (req, res) => {
      try {
        const taskId = req.params.id;
        const query = { _id: new ObjectId(taskId) };

        const result = await tasksCollection.deleteOne(query);
        res.send({ success: true, deletedCount: result.deletedCount });
      } catch (error) {
        res.status(500).send({ message: "Task ডিলিট করতে সমস্যা হয়েছে" });
      }
    });

    // ৬. Transactions History — সব Stripe পেমেন্ট হিস্ট্রি দেখা
    app.get("/admin/transactions", async (req, res) => {
      try {
        const result = await paymentsCollection.find().toArray();
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Transactions আনতে সমস্যা হয়েছে" });
      }
    });

    // await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
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
