const zxcvbn = require('zxcvbn');

// يرجّع: score (0-4), label, feedback
function checkPasswordStrength(password, userInputs = []) {
 const result = zxcvbn(password, userInputs);
 const labels = ['ضعيفة جداً', 'ضعيفة', 'متوسطة', 'قوية', 'ممتازة'];
 return {
 score: result.score,
 label: labels[result.score],
 crackTimeDisplay: result.crack_times_display.offline_slow_hashing_1e4_per_second,
 feedback: result.feedback.suggestions,
 isAcceptable: result.score >= 2, // نمنع التسجيل تحت "متوسطة"
 };
}

module.exports = { checkPasswordStrength };
