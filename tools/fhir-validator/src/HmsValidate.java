// Validates FHIR JSON files with the official HL7 validation engine 6.10.4
// against FHIR R4 4.0.1 and the ABDM IG ndhm.in#6.5.0 (profiles from each
// resource's meta.profile). Prints one line per issue; exits 1 on any error.
// Usage: java -cp lib/*:classes HmsValidate <dir-or-file>...   (HMS_FHIR_TX=n/a for offline)
import java.nio.file.*;
import java.util.*;
import org.hl7.fhir.r5.elementmodel.Manager.FhirFormat;
import org.hl7.fhir.r5.model.OperationOutcome;
import org.hl7.fhir.utilities.FhirPublication;
import org.hl7.fhir.utilities.validation.ValidationMessage;
import org.hl7.fhir.validation.ValidationEngine;

public class HmsValidate {
  public static void main(String[] args) throws Exception {
    String tx = System.getenv().getOrDefault("HMS_FHIR_TX", "http://tx.fhir.org");
    ValidationEngine.ValidationEngineBuilder b = new ValidationEngine.ValidationEngineBuilder().withDefaultInstanceValidatorParameters(new org.hl7.fhir.validation.service.model.InstanceValidatorParameters().setAssumeValidRestReferences(true)).withVersion("4.0.1").withUserAgent("hms-validate");
    b = "n/a".equals(tx) ? b.withNoTerminologyServer().withCanRunWithoutTerminologyServer(true) : b.withTxServer(tx, null, FhirPublication.R4, true);
    ValidationEngine ve = b.fromSource("hl7.fhir.r4.core#4.0.1");
    ve.getIgLoader().loadIg(ve.getIgs(), ve.getBinaries(), "ndhm.in#6.5.0", false);
    // Resources are read one at a time from a REST server; references to
    // other resources on that server are assumed valid (validator -assumeValidRestReferences).
    ve.setAssumeValidRestReferences(true);
    List<Path> files = new ArrayList<>();
    for (String a : args) { Path p = Paths.get(a); if (Files.isDirectory(p)) try (var s = Files.list(p)) { s.filter(f -> f.toString().endsWith(".json")).sorted().forEach(files::add); } else files.add(p); }
    int errors = 0, warnings = 0;
    for (Path f : files) {
      List<ValidationMessage> messages = new ArrayList<>();
      OperationOutcome oo = ve.validate(Files.readAllBytes(f), FhirFormat.JSON, new ArrayList<>(), messages);
      int fileErrors = 0;
      for (OperationOutcome.OperationOutcomeIssueComponent i : oo.getIssue()) {
        String sev = i.getSeverity().toCode();
        if (sev.equals("error") || sev.equals("fatal")) { errors++; fileErrors++; } else if (sev.equals("warning")) warnings++; else continue;
        String loc = i.getExpression().isEmpty() ? "" : i.getExpression().get(0).asStringValue();
        System.out.println(sev.toUpperCase() + " " + f.getFileName() + " " + loc + " :: " + i.getDetails().getText());
      }
      System.out.println((fileErrors == 0 ? "OK   " : "FAIL ") + f.getFileName());
    }
    System.out.println("validated " + files.size() + " files: " + errors + " errors, " + warnings + " warnings");
    System.exit(errors == 0 ? 0 : 1);
  }
}
