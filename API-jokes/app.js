const express = require('express')
const cors = require('cors')
const mongoose = require('mongoose')
const dns = require('dns')
const app = express()

require('./JokeSchema')

const jokeModel = mongoose.model('joke')

main().catch(err => console.log(err));


async function main() {
  // Resolve host.docker.internal to its IP address
  dns.lookup('host.docker.internal', (err, address, family) => {
    if (err) {
      console.log('Error resolving host.docker.internal:', err);
    } else {
      console.log('host.docker.internal resolves to:', address);
    }
  });
  
  await mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });  
}

mongoose.connection.on('connected',()=>{
    console.log("conneted to mongo yeahh")
})
mongoose.connection.on('error',(err)=>{
    console.log("err connecting",err)
})

app.use(express.json())
app.use(cors())

app.get('/getJokes',async (req,res)=>{
       const jokes = await jokeModel.find({});
       res.json({jokes})
})

app.get('/',(req,res)=>{
   res.json({message:"application is up and running v3"})
})

app.post('/post-joke',async (req,res)=>{
    try{
        const newJoke =  await jokeModel.create({
            joke:req.body.joke
        })
        res.json({newJoke:newJoke})
    }catch(err){
        console.log(err)
    }
   
})

app.get('/crash',(req,res)=>{
    res.send('Server is crashing...');
    setTimeout(() => process.exit(1), 100);
})

app.listen(5000,()=>{
    console.log("server running on 5000")
})