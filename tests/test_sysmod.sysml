occurrence Test_SYSMOD_Project {
    private import SYSMOD::*;

    #project occurrence def TestProject {
        doc /* The purpose of the TestProject is to test the purpose of the TestProject. */
        attribute :>> purpose = "This is the purpose of the Project";
        part :>> projectOwner {
            attribute :>> name = "Tim Tester";
        }
    }
}

occurrence Test_SYSMOD_ProblemStatement {
    private import SYSMOD::*;

    #project occurrence def TestProject_ProblemStatement {
        doc /* The purpose of the TestProject is to test the purpose of the TestProject. */
        attribute :>> purpose = "This is the purpose of the Project";
        part :>> projectOwner {
            attribute :>> name = "Tim Tester";
        }
        concern :>> problemStatement {
            doc /* How can we ... */
        }
    }
}

occurrence Test_SYSMOD_Brownfield {
    private import SYSMOD::*;

    #project occurrence def TestProject_ProblemStatement {
        doc /* The purpose of the TestProject is to test the purpose of the TestProject. */
        attribute :>> purpose = "This is the purpose of the Project";
        part :>> projectOwner {
            attribute :>> name = "Tim Tester";
        }
        concern :>> problemStatement {
            doc /* How can we ... */
        }
        part brownfield : BrownfieldContext :>> brownfieldContext;
        part brownfieldImpl : BrownfieldContextImpl :>> brownfieldContextImpl;
    }
    #systemContext part def BrownfieldContext {
        #system part brownfieldSystem :>> soi {
            port bsP1 :> systemPorts;
            port bsP2 :> systemPorts;
        }
        #user part actor1 :> actors {
            port a1P1 :> actorPorts;
        }
        #externalSystem part actor2 :> actors {
            port a2P1 :> actorPorts;
        }

        interface :> asis connect actor1.a1P1 to brownfieldSystem.bsP1;
        interface :> asis connect actor2.a2P1 to brownfieldSystem.bsP2;
    }
    part def BrownfieldContextImpl :> SystemContext, BrownfieldContext {
        #system part brownfieldSystemImpl : BrownfieldSystemImpl :>> soi, brownfieldSystem;
    }
    part def BrownfieldSystem {
        part component1;
        part component2;
        connect component1 to component2;
    }
    part def BrownfieldSystemImpl :> BrownfieldSystem;
}