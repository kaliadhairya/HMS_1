output "ec2_public_ip" {
  value       = aws_instance.hms_server.public_ip
  description = "Public IP address of the provisioned HMS EC2 server"
}

output "hms_frontend_url" {
  value       = "http://${aws_instance.hms_server.public_ip}:4999"
  description = "Direct Web Application URL for Hospital Management System"
}

output "hms_backend_api_health" {
  value       = "http://${aws_instance.hms_server.public_ip}:5001/api/health"
  description = "Health check endpoint for the Express backend API"
}

output "ssh_command" {
  value       = "ssh ubuntu@${aws_instance.hms_server.public_ip}"
  description = "Convenience SSH command to connect to the EC2 server"
}
