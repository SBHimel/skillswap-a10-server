# 🚀 SkillSwap - Backend Server

<div align="center">
  <img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white" alt="Express" />
  <img src="https://img.shields.io/badge/MongoDB-47A248?style=for-the-badge&logo=mongodb&logoColor=white" alt="MongoDB" />
</div>

## 📖 Project Purpose
The **SkillSwap Backend** is a robust RESTful API built to handle the server-side operations of the SkillSwap platform. It manages secure user authentication, database operations (CRUD), role validation, and administrative oversight to ensure a seamless experience for all platform users.

## ✨ Key Features
* **🛡️ Secure Data Management:** All sensitive information including database credentials is kept secure via environment variables.
* **🔐 Authentication Integration:** Validates user sessions and interacts securely with Better Auth workflows.
* **⚡ Admin Security Layer:** Dedicated API endpoint (`/admin/users/check-status`) to monitor user account status (e.g., blocking/unblocking users) in real-time.
* **🚀 Optimized Performance:** Efficient API design ensuring fast responses for front-end dashboard interactions.
* **⚠️ Comprehensive Error Handling:** Proper error messages for all endpoints, ensuring the client-side always receives meaningful feedback.

## 🛠️ Tech Stack & NPM Packages
* **Runtime:** Node.js
* **Framework:** Express.js
* **Database:** MongoDB
* **Dependencies:**
  * `dotenv` - Environment variable management
  * `cors` - Cross-Origin Resource Sharing
  * `express` - Web framework
  * `mongodb` - Database driver

## 🔐 Environment Variables (.env)
To run the server locally, create a `.env` file in the root of the server directory and configure the following keys:

```env
# MongoDB Connection String
MONGODB_URI=mongodb+srv://your_username:your_password@cluster.mongodb.net/skillswap

# Application Port
PORT=5000

# Better Auth Configuration (Sync with client)
BETTER_AUTH_SECRET=your_super_secret_key

🚀 Run Locally
Follow these steps to set up the server:

1. Navigate to the server folder:

Bash
cd skillswap-server


2. Install dependencies:

Bash
npm install


3. Start the development server:

Bash
# Using nodemon for auto-reload
npm run dev


4. API Base URL:
The server will run at http://localhost:5000

Built for the SkillSwap Platform | Designed to ensure security and scalability.