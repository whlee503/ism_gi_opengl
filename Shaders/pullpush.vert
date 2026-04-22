#version 410 core
layout(location=0) in vec3 inPosition;
layout(location=2) in vec2 inTexCoord;

out vec2 texCoord;

void main() {
    texCoord = vec2(inTexCoord.x, 1.0 - inTexCoord.y);
    gl_Position = vec4(inPosition, 1.0);
}