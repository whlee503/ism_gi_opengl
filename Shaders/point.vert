#version 430 core
layout(location = 0) in vec3 inPosition;
layout(location = 1) in vec3 inNormal;

uniform mat4 viewMat;
uniform mat4 projMat;

void main() {
    gl_Position = projMat * viewMat * vec4(inPosition, 1.0);
    gl_PointSize = 3.0; // 점 크기 키움
}