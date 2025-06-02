require("dotenv").config()
const express=require("express")
const app=express()

const session=require("express-session");

const path=require("path")
app.set("view engine","ejs")
app.set("views",path.join(__dirname,"views"))
app.use(express.static(path.join(__dirname,"public")))

app.use('/images', express.static(__dirname + '/images'));

app.use(express.urlencoded({extended:true}))
app.use(express.json())

const bcrypt=require('bcrypt');
const saltRounds=10;

const mysql=require('mysql2');
const connection=mysql.createConnection({
    host:process.env.db_host,
    user:process.env.db_user,
    database:process.env.db_name,
    password:process.env.db_password
})

app.use(session({
    secret: process.env.session_secret,
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 1 day
}));

const {v4: uuidv4}=require('uuid');

const port=3306

function isEmployer(req, res, next) {
    if (req.session.user && req.session.user.role === "Employer") {
      return next();
    } else {
    req.session.redirectTo = req.originalUrl;
      return res.redirect("/login");
    }
  }

  function isFreelancer(req, res, next) {
    if (req.session.user && req.session.user.role === "Freelancer") {
      return next();
    } else {
    req.session.redirectTo = req.originalUrl;
      return res.redirect("/login");
    }
  }

function isLoggedIn(req, res, next) {
  if (req.session.user && req.session.user.id) {
    return next();
  } else {
    req.session.redirectTo = req.originalUrl;
    return res.redirect("/login");
  }
}

app.use((req, res, next) => {
    res.locals.currentUser = req.session.user;  // Correct
    console.log(req.session.user);
    next();
});


//Employer setup
//index route
app.get("/",(req,res)=>{
    res.render("employer/index.ejs")
})

//signup page
app.get("/signup",(req,res)=>{
    res.render("employer/signup.ejs")
})

//add new user
app.post("/signup",async (req,res)=>{
    let {name,email,role,password}=req.body;
    let id=uuidv4();
    try {
        const hashedPassword = await bcrypt.hash(password,saltRounds);
        const q=`insert into users (user_id,name,email,role,password) values ('${id}','${name}','${email}','${role}','${hashedPassword}');`
        connection.query(q,(err,result)=>{
            if (err) {
                console.log("DB Error during signup:", err);
                return res.status(500).send("An error occurred during sign-up");
            }
            req.session.user = {
                id: id,
                name: name,
                role: role
            };
            if (role === "Employer") {
                return res.redirect("/employer/dashboard");
            } else {
                return res.redirect("/freelancer/dashboard");
            }
        });
    }catch{
        res.status(500).send('An error occured')
    }
})

//login
app.get("/login",(req,res)=>{
    res.render("employer/login.ejs");
})

app.post("/login",(req,res)=>{
    let {email,password}=req.body;
    const q=`select * from users where email='${email}';`;
    connection.query(q,async (err,result)=>{
        if (err) {
            console.log("DB error:", err);
            return res.redirect("/login");
        }

        if (result.length === 0) {
            console.log("No such user");
            return res.redirect("/login");
        }

        const user = result[0];
        const match = await bcrypt.compare(password, user.password);

        if (match) {
            req.session.user = {
                id: user.user_id,
                name: user.name,
                role: user.role
            };
            
            const redirectTo = (
                user.role.toLowerCase() === "employer" ? "/employer/dashboard" : "/freelancer/dashboard"
            );
            
            delete req.session.redirectTo; // Clean up
            return res.redirect(redirectTo);
        } else {
            console.log("Password mismatch");
            return res.redirect("/login");
        }
    })
})

//give review to freelancer
app.get("/employer/review-proposal/:app_id",(req,res)=>{
    let application_id=req.params.app_id;
    res.render("employer/review.ejs",{application_id: application_id});
})

app.post("/employer/review-proposal/:app_id",(req,res)=>{
    let app_id=req.params.app_id;
    let review_id=uuidv4()
    let employer_id=req.session.user.id;
    let {feedback,rating}=req.body;
    const query=`select freelancer_id,job_id from applications where application_id='${app_id}';`;
    connection.query(query,(err,result)=>{
        if(err){
            console.log(err);
            res.status(500).send("Error")
        }
        if (result.length === 0) {
            return res.status(404).send("Application not found.");
        }
        let job_id=result[0].job_id;
        let freelancer_id=result[0].freelancer_id;
        console.log(freelancer_id,job_id);
        const q=`insert into reviews (review_id,freelancer_id,employer_id,job_id,rating,feedback) values ('${review_id}','${freelancer_id}','${employer_id}','${job_id}','${rating}','${feedback}');`;
        connection.query(q,(err,result)=>{
            if(err){
                console.log(err);
                res.status(500).send("Error")
            }
            res.redirect("/employer/dashboard");
        })
    })
})

// dashboard
app.get("/employer/dashboard", isEmployer, (req, res) => {
    const employerId = req.session.user.id;

    const q = `SELECT * FROM jobs WHERE employer_id='${employerId}';`;

    const appQuery = `SELECT a.*, u.name AS freelancer_name, j.title AS job_title
                      FROM applications a
                      JOIN users u ON a.freelancer_id = u.user_id
                      JOIN jobs j ON a.job_id = j.job_id
                      WHERE a.employer_id = '${employerId}'`;

    const freelancer_query = `SELECT a.*, u.name AS freelancer_name, j.title AS job_title
                              FROM applications a
                              JOIN users u ON a.freelancer_id = u.user_id
                              JOIN jobs j ON a.job_id = j.job_id
                              WHERE a.app_status = 'Accepted' AND a.employer_id = '${employerId}'`;

    const reviews_query = `SELECT 
                           r.review_id,
                           r.freelancer_id,
                           r.job_id,
                           u.name AS freelancer_name,
                           j.title AS job_title,
                           r.rating,
                           r.feedback
                           FROM reviews r
                           JOIN users u ON r.freelancer_id = u.user_id
                           JOIN jobs j ON r.job_id = j.job_id
                           WHERE r.employer_id = '${employerId}'`;

    const paymentQuery = `SELECT p.*, u.name AS freelancer_name, j.title AS job_title
                          FROM payments p
                          JOIN users u ON p.freelancer_id = u.user_id
                          JOIN jobs j ON p.job_id = j.job_id
                          WHERE p.employer_id = '${employerId}' AND p.pay_status = 'Completed'`;

    const stat_query = `
        SELECT 
            (SELECT COUNT(*) FROM jobs WHERE employer_id = '${employerId}') AS total_posted_jobs,
            (SELECT COUNT(DISTINCT freelancer_id) FROM applications WHERE employer_id = '${employerId}' AND app_status = 'Accepted') AS total_freelancers_hired,
            (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE employer_id = '${employerId}' AND pay_status = 'Completed') AS total_payments,
            (SELECT ROUND(AVG(rating), 2) FROM reviews WHERE employer_id = '${employerId}') AS average_rating
    `;

    connection.query(q, (err, listed_jobs) => {
        if (err) return res.status(500).send("Error fetching jobs");

        connection.query(stat_query, (err, stat_data) => {
            if (err) return res.status(500).send("Error fetching stats");

            connection.query(appQuery, (err, listed_applications) => {
                if (err) return res.status(500).send("Error fetching applications");

                connection.query(freelancer_query, (err, hired_freelancers) => {
                    if (err) return res.status(500).send("Error fetching hired freelancers");

                    connection.query(reviews_query, (err, submitted_reviews) => {
                        if (err) return res.status(500).send("Error fetching reviews");

                        connection.query(paymentQuery, (err, payments) => {
                            if (err) return res.status(500).send("Error fetching payments");

                            // Add has_review and has_paid flags
                            hired_freelancers = hired_freelancers.map(freelancer => {
                                const hasReview = submitted_reviews.some(review =>
                                    review.freelancer_id === freelancer.freelancer_id &&
                                    review.job_id === freelancer.job_id
                                );
                                const hasPaid = payments.some(payment =>
                                    payment.freelancer_id === freelancer.freelancer_id &&
                                    payment.job_id === freelancer.job_id
                                );
                                return {
                                    ...freelancer,
                                    has_review: hasReview,
                                    has_paid: hasPaid
                                };
                            });
                            res.render("employer/dashboard.ejs", {
                                jobs: listed_jobs,
                                applications: listed_applications,
                                freelancers: hired_freelancers,
                                reviews: submitted_reviews,
                                payments: payments,
                                stat: stat_data[0] // First row from SELECT
                            });
                        });
                    });
                });
            });
        });
    });
});



//edit review
app.get("/employer/edit-review/:rev_id",(req,res)=>{
    let review_id=req.params.rev_id;
    const q=`select * from reviews where review_id='${review_id}';`;
    connection.query(q,(err,found_review)=>{
        if(err) {
            console.log("Error");
            res.status(500).send("Error")
        }
        res.render("employer/edit_review.ejs",{review: found_review[0]});
    })
})

app.post("/employer/edit-review/:rev_id",(req,res)=>{
    let review_id=req.params.rev_id;
    let {feedback,rating}=req.body;
    const q=`update reviews set feedback='${feedback}', rating='${rating}' where review_id='${review_id}';`
    connection.query(q,(err,result)=>{
        if(err){
            console.log(err);
            res.status(500).send("Error");
        }
        res.redirect("/employer/dashboard");
    })
})

//delete review
app.get("/employer/delete-review/:rev_id",(req,res)=>{
    let review_id=req.params.rev_id
    const q=`delete from reviews where review_id='${review_id}';`;
    connection.query(q,(err,result)=>{
        if(err){
            console.log(err);
            res.status(500).send("Error");
        }
        res.redirect("/employer/dashboard");
    })
})

//accept freelancer_application
app.get("/employer/accept-application/:app_id",(req,res)=>{
    let app_id=req.params.app_id;
    const q=`update applications set app_status='Accepted' where application_id='${app_id}';`;
    connection.query(q,(err,result)=>{
        if(err){
            console.log(err);
            return res.status(500).send("Error");
        }
        res.redirect("/employer/dashboard");
    })
})

//reject freelancer_application
app.get("/employer/decline-application/:app_id",(req,res)=>{
    let app_id=req.params.app_id;
    const q=`update applications set app_status='Rejected' where application_id='${app_id}';`;
    connection.query(q,(err,result)=>{
        if(err){
            console.log(err);
            return res.status(500).send("Error");
        }
        res.redirect("/employer/dashboard");
    })
})

//update a job
app.get("/employer/update-job/:job_id",(req,res)=>{
    let jobId=req.params.job_id;
    const q=`select * from jobs where job_id='${jobId}';`;
    connection.query(q,(err,found_job)=>{
        if(err){
            console.log(err);
            return res.status(500).send("Error")
        }
        res.render("employer/update.ejs",{job: found_job[0]});
    })
})

app.post("/employer/update-job/:job_id", (req, res) => {
    const jobId = req.params.job_id;
    let { title, description, budget } = req.body;

    const q = `UPDATE jobs SET title = ?, description = ?, budget = ? WHERE job_id = ?`;
    const values = [title, description, budget, jobId];

    connection.query(q, values, (err, result) => {
        if (err) {
            console.log(err);
            if (!res.headersSent) return res.status(500).send("Error");
            return;
        }
        if (!res.headersSent) res.redirect("/employer/dashboard");
    });
});


//delete job
app.get("/employer/delete-job/:job_id",(req,res)=>{
    let jobId=req.params.job_id;
    const q=`delete from jobs where job_id='${jobId}';`;
    connection.query(q,(err,result)=>{
        if(err){
            console.log(err);
            res.status(500).send("Error");
        }
       res.redirect("/employer/dashboard");
    })
})

//post a job
app.get("/employer/post-job",isEmployer,(req,res)=>{
    res.render("employer/post-job.ejs");
})

app.post("/employer/post-job", isEmployer, (req, res) => {
    let { title, description, budget } = req.body;
    let job_id = uuidv4();
    let emp_id = req.session.user.id;

    const q = `INSERT INTO jobs (job_id, title, description, budget, employer_id) VALUES (?, ?, ?, ?, ?)`;
    const values = [job_id, title, description, budget, emp_id];

    connection.query(q, values, (err, result) => {
        if (err) {
            console.log("Error occurred", err);
            return res.status(500).send("Error");
        }
        res.redirect("/employer/dashboard");
    });
});

//employer settings
app.get("/employer/settings",isEmployer,(req,res)=>{
        const employerId = req.session.user.id;
        const q = `SELECT * FROM users WHERE user_id = '${employerId}'`;
    
        connection.query(q, (err, result) => {
            if (err) {
                console.log("Error fetching employer details:", err);
                return res.status(500).send("Server error");
            }
            res.render("employer/settings.ejs", { employer: result[0] });
        });
    });

    app.post("/employer/settings", isEmployer, (req, res) => {
        const employerId = req.session.user.id;
        const { name, email, password } = req.body;
    
        const q = `UPDATE users SET name = ?, email = ?, password = ? WHERE user_id = ?`;
        connection.query(q, [name, email, password, employerId], (err, result) => {
            if (err) {
                console.log("Error updating employer info:", err);
                return res.status(500).send("Error updating info");
            }
            // Optional: Update session info too
            req.session.user.name = name;
            req.session.user.email = email;
            res.redirect("/employer/dashboard");
        });
    });   

//make payments
app.get("/employer/make-payment/:free_id",(req,res)=>{
    let freelancer_id=req.params.free_id;
    const q=`update payments set pay_status='Completed' where freelancer_id='${freelancer_id}';`;
    connection.query(q,(err,result)=>{
        if (err) {
            console.log(err);
            return res.status(500).send("Error in payment");
        }
        res.redirect("/employer/dashboard");
    })
})

//logout route
app.get("/logout", (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error("Logout error:", err);
            return res.status(500).send("Something went wrong while logging out.");
        }
        res.clearCookie("connect.sid"); 
        res.redirect("/"); 
    });
});


//Freelancer
//Dashboard
app.get("/freelancer/dashboard", isFreelancer, (req, res) => {
    const freelancerId = req.session.user.id;
    const user_q=`select name from users where user_id='${freelancerId}';`;
    const appsQuery = `SELECT a.*, j.title AS job_title, j.description, j.budget, u.name AS employer_name
                       FROM applications a
                       JOIN jobs j ON a.job_id = j.job_id
                       JOIN users u ON a.employer_id = u.user_id
                       WHERE a.freelancer_id = ?`;


    const reviewsQuery = `SELECT r.*, j.title AS job_title
                          FROM reviews r
                          JOIN jobs j ON r.job_id = j.job_id
                          WHERE r.freelancer_id = ?`;

    const paymentQuery = `SELECT 
  payments.payment_id,
  jobs.title AS job_title,
  payments.amount,
  payments.pay_status
FROM payments
JOIN jobs ON payments.job_id = jobs.job_id
WHERE payments.freelancer_id = ? AND payments.pay_status = 'Completed';
`;

    connection.query(appsQuery, [freelancerId], (err, applications) => {
        if (err) return res.status(500).send("Error fetching applications");

        connection.query(reviewsQuery, [freelancerId], (err, reviews) => {
            if (err) return res.status(500).send("Error fetching reviews");

            connection.query(paymentQuery, [freelancerId], (err, payments) => {
                if (err) return res.status(500).send("Error fetching recieved_payments");
                connection.query(user_q, [freelancerId], (err, result) => {
                    if (err) return res.status(500).send("Error fetching name");
                    const name = result[0]?.name;
                    res.render("freelancer/dashboard.ejs", { applications, reviews, payments, name });
                });

            });
        });
    });
});

//get profile for freelancer
app.get("/freelancer/get_profile/:id",isEmployer,(req,res)=>{
   const freelancerId=req.params.id;
    // Query to get Name, Email, Title, Skills, Bio
    const userQuery = `SELECT name, email,user_id FROM users WHERE user_id = ?`;
    const freelancerQuery = `SELECT f.title, f.skills, f.bio
    FROM freelancers f
    WHERE f.freelancer_id = ?;`;

    // Query to get Completed Jobs Count
    const completedJobsQuery = `
       SELECT Count(*) as total_job_count
    FROM jobs j
    JOIN applications a ON j.job_id = a.job_id
    WHERE a.freelancer_id = ? AND a.app_status = 'Accepted' AND j.job_status = 'Closed';
    `;

    // Query to get Total Earnings
    const totalEarningsQuery = `SELECT SUM(p.amount) AS total_earnings
    FROM payments p
    JOIN jobs j ON p.job_id = j.job_id
    WHERE p.freelancer_id = ? AND p.pay_status = 'Completed' AND j.job_status = 'Closed';`;

    // Query to get Average Rating
    const averageRatingQuery = `SELECT AVG(r.rating) AS average_rating
    FROM reviews r
    JOIN jobs j ON r.job_id = j.job_id
    WHERE r.freelancer_id = ? AND j.job_status = 'Closed'`;

    // Query to get Job History
    const jobHistoryQuery = `
  SELECT 
    j.title AS job_title, 
    j.budget, 
    r.feedback AS review
  FROM jobs j
  INNER JOIN applications a ON j.job_id = a.job_id
  INNER JOIN reviews r ON r.job_id = j.job_id AND r.freelancer_id = a.freelancer_id
  WHERE 
    a.freelancer_id = ? 
    AND a.app_status = 'Accepted' 
    AND j.job_status = 'Closed'
  ORDER BY j.job_id DESC;
`;

    connection.query(userQuery, [freelancerId], (err, userResult) => {
        if (err) return res.status(500).send("Error fetching user data");

        connection.query(freelancerQuery, [freelancerId], (err, freelancerResult) => {
            if (err) return res.status(500).send("Error fetching freelancer data");

            connection.query(completedJobsQuery, [freelancerId], (err, completedJobsResult) => {
                if (err) return res.status(500).send("Error fetching completed jobs");

                connection.query(totalEarningsQuery, [freelancerId], (err, earningsResult) => {
                    if (err) return res.status(500).send("Error fetching total earnings");

                    connection.query(averageRatingQuery, [freelancerId], (err, ratingResult) => {
                        if (err) return res.status(500).send("Error fetching average rating");

                        connection.query(jobHistoryQuery, [freelancerId], (err, jobHistoryResult) => {
                            if (err) return res.status(500).send("Error fetching job history");
                            res.render("freelancer/getProfile.ejs",{user_data:userResult[0], freelancer_data:freelancerResult[0],job_count:completedJobsResult[0],earnings:earningsResult[0],rating:ratingResult[0],jobs_hist:jobHistoryResult});
                        })
                    })
                })
            })
        })
    })
 })

//browse freelancers
app.get("/employer/browse-freelancers",(req,res)=>{
    const q=`select user_id,name from users where role='Freelancer';`;
    connection.query(q,(err,freelancers)=>{
        if (err) return res.status(500).send("Error");
        res.render("employer/allFreelancers.ejs",{freelancers:freelancers});
    })
})

// Browse Jobs
app.get("/freelancer/browse-jobs", isFreelancer, (req, res) => {
    const freelancerId = req.session.user.id;
    const q = `
        SELECT 
            j.*, 
            u.name AS employer_name 
        FROM 
            jobs j
        JOIN 
            users u ON j.employer_id = u.user_id
        WHERE 
            j.job_status = 'Open'
            AND NOT EXISTS (
                SELECT 1 
                FROM applications a 
                WHERE a.job_id = j.job_id 
                AND a.freelancer_id = ?
            );
    `;
    connection.query(q, [freelancerId], (err, jobs) => {
        if (err) return res.status(500).send("Error loading jobs");
        console.log(jobs);
        res.render("freelancer/browse-jobs.ejs", { jobs });
    });
});


// Apply to Job
app.get("/freelancer/apply/:job_id",(req,res)=>{
    const q = `SELECT * FROM jobs where job_id='${req.params.job_id}'`;
    connection.query(q, (err, jobs) => {
        if (err) return res.status(500).send("Error loading jobs");
        console.log(jobs);
        res.render("freelancer/proposal.ejs", { job:jobs[0] });
    });
})

app.post("/freelancer/apply/:job_id", isFreelancer, (req, res) => {
    const jobId = req.params.job_id;
    const freelancerId = req.session.user.id;
    const applicationId = uuidv4();
    const {proposal} = req.body;
    const employerQuery = `SELECT employer_id FROM jobs WHERE job_id = ?`;

    connection.query(employerQuery, [jobId], (err, result) => {
        if (err || result.length === 0) return res.status(500).send("Job not found");

        const employerId = result[0].employer_id;

        const q = `INSERT INTO applications (application_id, job_id, freelancer_id, employer_id, proposal,app_status)
                   VALUES (?, ?, ?, ?,?, 'Pending')`;

        connection.query(q, [applicationId, jobId, freelancerId, employerId,proposal], (err) => {
            if (err) return res.status(500).send("Error applying to job");
            res.redirect("/freelancer/dashboard");
        });
    });
});

//profile
app.get("/freelancer/profile",isFreelancer,(req,res)=>{
    const user_pay_rev_q=`SELECT 
  u.name,
  u.email,
  f.title,
  f.skills,
  f.bio
FROM users u
LEFT JOIN freelancers f ON u.user_id = f.freelancer_id
WHERE u.user_id = '${req.session.user.id}';
`;
connection.query(user_pay_rev_q,(err,data1)=>{
       if (err) return res.status(500).send(err);
            res.render("freelancer/profile.ejs",{profile_data1: data1[0]})
        })
})

app.post("/freelancer/profile", (req, res) => {
    let { name, email, title, skills, bio } = req.body;

    const userId = req.session.user.id;

    const user_q = `UPDATE users SET name='${name}', email='${email}' WHERE user_id='${userId}';`;

    // First update the users table
    connection.query(user_q, (err, result) => {
        if (err) return res.status(500).send(err);

        // Check if freelancer row exists
        const checkFreelancer_q = `SELECT * FROM freelancers WHERE freelancer_id='${userId}'`;
        connection.query(checkFreelancer_q, (err, result2) => {
            if (err) return res.status(500).send(err);

            let freelancer_q;
            if (result2.length > 0) {
                // Row exists, so update
                freelancer_q = `UPDATE freelancers SET title='${title}', skills='${skills}', bio='${bio}' WHERE freelancer_id='${userId}'`;
            } else {
                // Row doesn't exist, so insert
                freelancer_q = `INSERT INTO freelancers (freelancer_id, title, skills, bio) VALUES ('${userId}', '${title}', '${skills}', '${bio}')`;
            }

            connection.query(freelancer_q, (err, result3) => {
                if (err) return res.status(500).send(err);
                res.redirect("/freelancer/dashboard");
            });
        });
    });
});


//chats
//get all chats
app.get("/view-chats",isLoggedIn,(req,res)=>{
    const userId = req.session.user.id;

const query = `
  SELECT 
      m.msg_id,
      m.sender_id,
      m.reciever_id,
      m.message,
      sender.name AS sender_name,
      receiver.name AS receiver_name
  FROM 
      messages m
  JOIN users sender ON m.sender_id = sender.user_id
  JOIN users receiver ON m.reciever_id = receiver.user_id
  WHERE
      m.sender_id = '${userId}' OR m.reciever_id = '${userId}'
`;
    connection.query(query,(err,messages)=>{
        if (err) return res.status(500).send(err);
        console.log(messages);
        res.render("allchats.ejs",{msgs:messages});
    })
})

//edit chat
app.get("/edit/:id", isLoggedIn,(req, res) => {
  const msgId = req.params.id;
  const loggedInUserId = req.session.user.id;  // assuming session holds logged in user id

  const query = `
    SELECT 
      m.msg_id,
      m.message,
      u.name AS receiver_name
    FROM 
      messages m
    JOIN 
      users u ON m.reciever_id = u.user_id
    WHERE 
      m.msg_id = ? AND m.sender_id = ?;
  `;

  connection.query(query, [msgId, loggedInUserId], (err, results) => {
    if (err) return res.status(500).send(err);
    res.render("edit-msg.ejs", { msg: results[0] });  // single message object
  });
});

app.post("/edit/:id",(req,res)=>{
    const {message} = req.body;
    const q=`update messages set message='${message}' where msg_id='${req.params.id}';`;
    connection.query(q,(err,result)=>{
        if (err) return res.status(500).send(err);
        res.redirect("/view-chats");
    })
})

//delete chat
app.get("/delete/:id",(req,res)=>{
    const q=`delete from messages where msg_id='${req.params.id}';`;
    connection.query(q,(err,result)=>{
        if (err) return res.status(500).send(err);
        res.redirect("/view-chats");
    })
})

//freelancer-new-chat
app.get("/freelancer/new-chat/:id",isFreelancer,(req,res)=>{
    const q=`select name,user_id from users where user_id='${req.params.id}';`;
    connection.query(q,(err,emp_det)=>{
        if (err) return res.status(500).send(err);
        console.log(emp_det);
        res.render("freelancer-new-chat.ejs",{emp_det:emp_det[0]});
    })
})

app.post("/freelancer/new-chat/:id",(req,res)=>{
    const {message} = req.body;
    const msg_id=uuidv4();
    const q=`insert into messages values ('${msg_id}','${req.session.user.id}','${req.params.id}','${message}');`;
    connection.query(q,(err,result)=>{
        if (err) return res.status(500).send(err);
        res.redirect("/view-chats");
    })
})

//employer-new-chat
app.get("/employer/new-chat/:id",isEmployer,(req,res)=>{
    const q=`select user_id,name from users where user_id='${req.params.id}';`;
    connection.query(q,(err,result)=>{
        if (err) return res.status(500).send(err);
        res.render("employer-new-chat.ejs",{data:result[0]});
    })
})

app.post("/employer/new-chat/:id",(req,res)=>{
    const {message} = req.body;
    const msg_id=uuidv4();
    const q=`insert into messages values ('${msg_id}','${req.session.user.id}','${req.params.id}','${message}');`;
    connection.query(q,(err,result)=>{
        if (err) return res.status(500).send(err);
        res.redirect("/view-chats");
    })
})

app.listen(port,()=>{
    console.log(`Listening to port ${port}`);
})
