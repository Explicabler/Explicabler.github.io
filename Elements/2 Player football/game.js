const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const keys = {};
document.addEventListener("keydown", e => keys[e.key] = true);
document.addEventListener("keyup", e => keys[e.key] = false);

const player1 = { x: 150, y: 250, r: 25, color: "#ff3b3b", score: 0 };
const player2 = { x: 850, y: 250, r: 25, color: "#3b6bff", score: 0 };

const ball = { x: 500, y: 250, r: 15, dx: 0, dy: 0 };

function reset() {
    ball.x = canvas.width / 2;
    ball.y = canvas.height / 2;
    ball.dx = (Math.random() - 0.5) * 8;
    ball.dy = (Math.random() - 0.5) * 8;
}

function movePlayers() {
    const speed = 5;

    if (keys["w"]) player1.y -= speed;
    if (keys["s"]) player1.y += speed;
    if (keys["a"]) player1.x -= speed;
    if (keys["d"]) player1.x += speed;

    if (keys["ArrowUp"]) player2.y -= speed;
    if (keys["ArrowDown"]) player2.y += speed;
    if (keys["ArrowLeft"]) player2.x -= speed;
    if (keys["ArrowRight"]) player2.x += speed;

    keepInside(player1);
    keepInside(player2);
}

function keepInside(p) {
    p.x = Math.max(p.r, Math.min(canvas.width - p.r, p.x));
    p.y = Math.max(p.r, Math.min(canvas.height - p.r, p.y));
}

function moveBall() {
    ball.x += ball.dx;
    ball.y += ball.dy;

    ball.dx *= 0.995;
    ball.dy *= 0.995;

    if (ball.y < ball.r || ball.y > canvas.height - ball.r)
        ball.dy *= -1;

    // Goals
    if (ball.x < ball.r && ball.y > 150 && ball.y < 350) {
        player2.score++;
        reset();
    }
    if (ball.x > canvas.width - ball.r && ball.y > 150 && ball.y < 350) {
        player1.score++;
        reset();
    }
}

function collide(player) {
    const dx = ball.x - player.x;
    const dy = ball.y - player.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < player.r + ball.r) {
        const angle = Math.atan2(dy, dx);
        const power = 7;
        ball.dx = Math.cos(angle) * power;
        ball.dy = Math.sin(angle) * power;
    }
}

function drawField() {
    // Grass gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, "#1f8f1f");
    gradient.addColorStop(1, "#146614");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Field stripes
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    for (let i = 0; i < canvas.width; i += 80) {
        ctx.fillRect(i, 0, 40, canvas.height);
    }

    ctx.strokeStyle = "white";
    ctx.lineWidth = 4;

    // Middle line
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2, 0);
    ctx.lineTo(canvas.width / 2, canvas.height);
    ctx.stroke();

    // Center circle
    ctx.beginPath();
    ctx.arc(canvas.width / 2, canvas.height / 2, 80, 0, Math.PI * 2);
    ctx.stroke();

    // Goals
    ctx.fillStyle = "#ccc";
    ctx.fillRect(0, 150, 10, 200);
    ctx.fillRect(canvas.width - 10, 150, 10, 200);
}

function drawPlayer(p) {
    // Shadow
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath();
    ctx.arc(p.x + 4, p.y + 4, p.r, 0, Math.PI * 2);
    ctx.fill();

    // Body
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();

    // Outline
    ctx.strokeStyle = "white";
    ctx.lineWidth = 2;
    ctx.stroke();
}

function drawBall() {
    ctx.fillStyle = "white";
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "black";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Simple pattern
    ctx.beginPath();
    ctx.moveTo(ball.x - 5, ball.y);
    ctx.lineTo(ball.x + 5, ball.y);
    ctx.moveTo(ball.x, ball.y - 5);
    ctx.lineTo(ball.x, ball.y + 5);
    ctx.stroke();
}

function drawScore() {
    ctx.fillStyle = "white";
    ctx.font = "40px Arial";
    ctx.fillText(player1.score, canvas.width / 2 - 80, 50);
    ctx.fillText(player2.score, canvas.width / 2 + 60, 50);
}

function loop() {
    movePlayers();
    moveBall();
    collide(player1);
    collide(player2);

    drawField();
    drawPlayer(player1);
    drawPlayer(player2);
    drawBall();
    drawScore();

    requestAnimationFrame(loop);
}

reset();
loop();
