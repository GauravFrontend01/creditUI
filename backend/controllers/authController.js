const User = require('../models/User');
const jwt = require('jsonwebtoken');

// Create JWT
const generateToken = (id) => {
  return jwt.sign({ id: id.toString() }, process.env.JWT_SECRET, {
    expiresIn: '30d',
  });
};

// @desc    Register a new user
// @route   POST /api/users/signup
// @access  Public
exports.registerUser = async (req, res) => {
  const { name, email, password } = req.body;
  console.log('Registration attempt:', { name, email });

  try {
    let userExists;
    try {
      userExists = await User.findOne({ email });
    } catch (findError) {
      console.error('Find user error:', findError);
      return res.status(500).json({ message: 'Database lookup failed', error: findError.message });
    }

    if (userExists) {
      return res.status(400).json({ message: 'User already exists' });
    }

    let user;
    try {
      user = await User.create({
        name,
        email,
        password,
      });
    } catch (createError) {
      console.error('Create user error:', createError);
      return res.status(500).json({ message: 'User creation failed', error: createError.message });
    }

    if (user) {
      res.status(201).json({
        _id: user._id,
        name: user.name,
        email: user.email,
        token: generateToken(user._id),
      });
    } else {
      res.status(400).json({ message: 'Invalid user data' });
    }
  } catch (error) {
    console.error('Unexpected registration error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// @desc    Auth user & get token
// @route   POST /api/users/login
// @access  Public
exports.loginUser = async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });

    if (user && (await user.matchPassword(password))) {
      res.json({
        _id: user._id,
        name: user.name,
        email: user.email,
        token: generateToken(user._id),
      });
    } else {
      res.status(401).json({ message: 'Invalid email or password' });
    }
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};
